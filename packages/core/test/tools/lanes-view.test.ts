/**
 * The time-tool helpers the element draws and moves the view with: sticky lane
 * headers, the clock's window and the named zooms.
 */

import { describe, expect, it } from "vitest";

import { densityMetrics } from "../../src/density.js";
import { layoutItems } from "../../src/layout.js";
import type { SceneElement } from "../../src/scene.js";
import { createHiddenDates } from "../../src/tools/hidden.js";
import { laneHeaderCss, laneHeaderNodes, withLaneHeaderLayer } from "../../src/tools/lanes.js";
import { DEFAULT_ZOOM_PRESETS, presetDomain, rollingDomain } from "../../src/tools/view.js";
import type { Item, Lane } from "../../src/types.js";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Monday 2026-01-05 00:00 UTC. */
const MONDAY = Date.UTC(2026, 0, 5);

const lanes: Lane[] = [
  { id: "a", label: "Alpha" },
  { id: "b", label: "Beta" },
  { id: "c" },
  { id: "d", label: "" },
  { id: "e", label: "Epsilon" },
];
const items: Item[] = lanes.flatMap((lane, at) => [
  { id: `${lane.id}1`, start: MONDAY + at * DAY, end: MONDAY + (at + 2) * DAY, laneId: lane.id },
  { id: `${lane.id}2`, start: MONDAY + at * DAY, end: MONDAY + (at + 3) * DAY, laneId: lane.id },
]);
const layout = layoutItems(items, { lanes });
const metrics = densityMetrics("comfortable", "horizontal");
const headerHeight = metrics.lineHeight + metrics.labelPadding;

const idsOf = (nodes: readonly SceneElement[]): string[] => nodes.map((node) => String(node.attrs?.["data-tl-lane-header"]));
const rectOf = (node: SceneElement | undefined): Record<string, unknown> => node?.children?.[0]?.attrs ?? {};

describe("sticky lane headers", () => {
  it("names each labelled lane at the view's start, and none without a label", () => {
    const nodes = laneHeaderNodes(layout, { orientation: "horizontal", density: "comfortable", crossOffset: 0, crossSize: 2000 });
    expect(idsOf(nodes)).toEqual(["a", "b", "e"]);
    for (const node of nodes) {
      expect(rectOf(node).x).toBe(0);
      expect(node.children?.[1]?.text ?? node.children?.[1]?.children?.[0]?.text).toBeDefined();
    }
    // Each at its own lane's top, under the axis band.
    const laneB = layout.lanes.find((laid) => laid.lane.id === "b");
    expect(rectOf(nodes[1]).y).toBe((laneB?.cross ?? 0) + metrics.axisSize);
  });

  it("holds a lane's name at the top of what is left of it, and lets go once the lane is gone", () => {
    const laneA = layout.lanes[0];
    if (laneA === undefined) throw new Error("no lane");
    // Half of lane a under the axis band: its name sits at the band's edge.
    const half = laneHeaderNodes(layout, { orientation: "horizontal", density: "comfortable", crossOffset: laneA.crossSize / 2, crossSize: 2000 });
    expect(idsOf(half)[0]).toBe("a");
    expect(rectOf(half[0]).y).toBe(metrics.axisSize);
    // Three quarters of a plate left: held to the lane's end, not past it.
    const tail = laneHeaderNodes(layout, { orientation: "horizontal", density: "comfortable", crossOffset: laneA.crossSize - 0.75 * headerHeight, crossSize: 2000 });
    expect(idsOf(tail)[0]).toBe("a");
    expect(rectOf(tail[0]).y).toBeCloseTo(metrics.axisSize - 0.25 * headerHeight, 9);
    // A quarter left: more than half the plate would be under the band.
    const quarter = laneHeaderNodes(layout, { orientation: "horizontal", density: "comfortable", crossOffset: laneA.crossSize - 0.25 * headerHeight, crossSize: 2000 });
    expect(idsOf(quarter)).not.toContain("a");
    const gone = laneHeaderNodes(layout, { orientation: "horizontal", density: "comfortable", crossOffset: laneA.crossSize, crossSize: 2000 });
    expect(idsOf(gone)).not.toContain("a");
    // A lane past the frame's far edge has no header.
    const short = laneHeaderNodes(layout, { orientation: "horizontal", density: "comfortable", crossOffset: 0, crossSize: metrics.axisSize + 1 });
    expect(idsOf(short)).toEqual(["a"]);
  });

  it("sizes the plate to a measurer when given, and keeps it a line of text in either orientation", () => {
    const measured = laneHeaderNodes(layout, { orientation: "horizontal", density: "comfortable", crossOffset: 0, crossSize: 2000, measure: () => 100 });
    expect(rectOf(measured[0]).width).toBe(100 + 2 * metrics.labelPadding);
    expect(rectOf(measured[0]).height).toBe(headerHeight);
    // Running down, the name is still read across: as wide as the name, a line high, at the top of its
    // own column — not a strip as tall as the name standing over the column's first items.
    const vertical = laneHeaderNodes(layout, { orientation: "vertical", density: "comfortable", crossOffset: 0, crossSize: 2000, measure: () => 100 });
    const verticalMetrics = densityMetrics("comfortable", "vertical");
    const plate = rectOf(vertical[0]);
    expect(plate.y).toBe(0);
    expect(plate.x).toBe((layout.lanes[0]?.cross ?? 0) + verticalMetrics.axisSize);
    expect(plate.width).toBe(100 + 2 * verticalMetrics.labelPadding);
    expect(plate.height).toBe(verticalMetrics.lineHeight + verticalMetrics.labelPadding);
    const text = vertical[0]?.children?.[1]?.attrs ?? {};
    expect(text.x).toBe(Number(plate.x) + verticalMetrics.labelPadding);
    expect(text.y).toBe(Number(plate.y) + Number(plate.height) / 2);
  });

  it("goes in a layer of its own, under the foreground, hidden from assistive technology", () => {
    const nodes = laneHeaderNodes(layout, { orientation: "horizontal", density: "comfortable", crossOffset: 0, crossSize: 2000 });
    const scene: SceneElement = {
      tag: "svg",
      children: [
        { tag: "g", attrs: { class: "tl-layer tl-layer--items" } },
        { tag: "g", attrs: { class: "tl-layer tl-layer--foreground" } },
      ],
    };
    const placed = withLaneHeaderLayer(scene, nodes);
    expect(placed.children?.map((child) => child.attrs?.class)).toEqual(["tl-layer tl-layer--items", "tl-layer tl-layer--lane-headers", "tl-layer tl-layer--foreground"]);
    expect(placed.children?.[1]?.attrs?.["aria-hidden"]).toBe("true");
    expect(placed.children?.[1]?.children).toBe(nodes);
    // Without a foreground, last; and empty too, so frames keep one structure.
    const bare = withLaneHeaderLayer({ tag: "svg" }, []);
    expect(bare.children).toEqual([{ tag: "g", attrs: { class: "tl-layer tl-layer--lane-headers", "aria-hidden": "true" }, children: [] }]);
    expect(laneHeaderCss(".tl.x")).toMatch(/^\.tl\.x \.tl-lane-header-bg\{.*\}\.tl\.x \.tl-lane-header-text\{/);
  });
});

describe("the clock's window", () => {
  it("puts now at the offset of the view, its span kept, the offset held to the view", () => {
    const domain = [MONDAY, MONDAY + 4 * DAY] as const;
    const now = MONDAY + 10 * DAY;
    expect(rollingDomain(domain, now)).toEqual([now - 2 * DAY, now + 2 * DAY]);
    expect(rollingDomain(domain, now, { offset: 0.25 })).toEqual([now - DAY, now + 3 * DAY]);
    expect(rollingDomain(domain, now, { offset: 3 })).toEqual([now - 4 * DAY, now]);
    expect(rollingDomain(domain, now, { offset: -1 })).toEqual([now, now + 4 * DAY]);
  });

  it("measures the span in shown time when dates are hidden", () => {
    // Nights 20:00–04:00 hidden: a day shows 16 hours.
    const hidden = createHiddenDates([{ start: MONDAY + 20 * HOUR, end: MONDAY + DAY + 4 * HOUR, repeat: "daily" }]);
    const domain = [MONDAY + 8 * HOUR, MONDAY + 3 * DAY + 8 * HOUR] as const;
    const now = MONDAY + 10 * DAY + 12 * HOUR;
    const next = rollingDomain(domain, now, { offset: 0.5 }, hidden);
    const span = hidden.toShown(domain[1]) - hidden.toShown(domain[0]);
    expect(hidden.toShown(next[1]) - hidden.toShown(next[0])).toBe(span);
    expect(hidden.toShown(now) - hidden.toShown(next[0])).toBe(span / 2);
  });
});

describe("named zooms", () => {
  it("frames the unit an instant falls in, from its aligned start: a week around a Thursday is that Monday to the next", () => {
    const week = DEFAULT_ZOOM_PRESETS.find((preset) => preset.id === "week");
    const month = DEFAULT_ZOOM_PRESETS.find((preset) => preset.id === "month");
    if (week === undefined || month === undefined) throw new Error("no preset");
    const thursday = MONDAY + 3 * DAY + 15 * HOUR;
    expect(presetDomain(week, [0, 1], { around: thursday })).toEqual([MONDAY, MONDAY + 7 * DAY]);
    expect(presetDomain(month, [0, 1], { around: thursday })).toEqual([Date.UTC(2026, 0, 1), Date.UTC(2026, 1, 1)]);
    // Around the view's middle unless told.
    expect(presetDomain(week, [thursday - HOUR, thursday + HOUR])).toEqual([MONDAY, MONDAY + 7 * DAY]);
  });

  it("aligns on the zone's calendar, and refuses a count that is not a positive integer", () => {
    const day = DEFAULT_ZOOM_PRESETS.find((preset) => preset.id === "day");
    if (day === undefined) throw new Error("no preset");
    // 5 January, 12:00 UTC is 13:00 in Budapest: its day began at 23:00 UTC.
    expect(presetDomain(day, [0, 1], { around: MONDAY + 12 * HOUR, timeZone: "Europe/Budapest" })).toEqual([MONDAY - HOUR, MONDAY + 23 * HOUR]);
    expect(() => presetDomain({ id: "x", label: "X", unit: "day", count: 0 }, [0, 1])).toThrow(RangeError);
    expect(() => presetDomain({ id: "x", label: "X", unit: "day", count: 1.5 }, [0, 1])).toThrow(RangeError);
  });
});
