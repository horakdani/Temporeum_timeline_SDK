/**
 * The dep-route check: dependency arrows, generated projects, both orientations,
 * every packing.
 *
 * Four claims, each on generated projects — tasks spread over lanes, packed
 * `pack`, `overlap` and `single`, joined by dependencies of every type:
 *
 *  - every route leaves the predecessor's edge its type names, moving the
 *    way that edge faces, and lands on the successor's edge, moving the way
 *    that one faces (`type-edges`);
 *  - every segment is axis-aligned (`orthogonal`);
 *  - the arrows' layer is drawn before — under — the item layer, with its
 *    transform, exact and in a space (`under-items`);
 *  - culling never leaves out a route that has a segment in the clip range,
 *    and does leave out some that have none (`cull-keeps-visible`), so the
 *    claim is not true only because nothing was culled.
 */

import { describe, expect, it } from "vitest";

import {
  dependencyEdges,
  dependencyId,
  dependencyNodes,
  dependencyPaths,
  routeDependencies,
  routePath,
  routePoints,
  taskBox,
  withDependencyLayer,
} from "../../src/gantt/index.js";
import { edgePoint } from "../../src/gantt/box.js";
import type { Dependency, DependencyRoute, DependencyType, RouteOptions } from "../../src/gantt/index.js";
import { densityMetrics } from "../../src/density.js";
import { layoutItems } from "../../src/layout.js";
import type { LayoutItem } from "../../src/layout.js";
import { renderTimeline } from "../../src/render.js";
import { createTimeScale } from "../../src/scale.js";
import { planSceneSpace } from "../../src/scene-space.js";
import type { SceneElement } from "../../src/scene.js";
import type { Item, Lane, MainCross, Orientation, PackMode } from "../../src/types.js";
import { makeRandom } from "../property/harness.js";
import { describeBothOrientations } from "../orientation.js";

const DAY = 86_400_000;
const ORIGIN = Date.UTC(2025, 0, 1);
const SEED = Number(process.env.SDK_DEP_ROUTE_SEED ?? 2020);
const CASES = 150;
const TYPES: readonly DependencyType[] = ["FS", "SS", "FF", "SF"];
const PACKS: readonly PackMode[] = ["pack", "overlap", "single"];

interface Project {
  readonly items: Item[];
  readonly lanes: Lane[];
  readonly dependencies: Dependency[];
  readonly pack: PackMode;
}

function generate(random: () => number, pack: PackMode): Project {
  const laneCount = 1 + Math.floor(random() * 8);
  const lanes: Lane[] = Array.from({ length: laneCount }, (_, at) => ({ id: `l${String(at)}`, label: `Lane ${String(at)}` }));
  const items: Item[] = [];
  const count = 2 + Math.floor(random() * 40);
  for (let at = 0; at < count; at += 1) {
    const start = ORIGIN + Math.floor(random() * 90) * DAY;
    const milestone = random() < 0.1;
    items.push({
      id: `t${String(at)}`,
      start,
      ...(milestone ? { kind: "milestone" as const } : { end: start + (1 + Math.floor(random() * 15)) * DAY }),
      laneId: (lanes[Math.floor(random() * laneCount)] as Lane).id,
      label: `Task ${String(at)}`,
    });
  }
  const dependencies: Dependency[] = [];
  const depCount = Math.floor(random() * count * 1.5);
  for (let at = 0; at < depCount; at += 1) {
    const from = items[Math.floor(random() * count)] as Item;
    const to = items[Math.floor(random() * count)] as Item;
    if (from.id === to.id) continue;
    dependencies.push({
      id: `d${String(at)}`,
      from: from.id,
      to: to.id,
      type: TYPES[Math.floor(random() * TYPES.length)] as DependencyType,
      ...(random() < 0.3 ? { lagMs: Math.floor(random() * 5 - 2) * DAY } : {}),
    });
  }
  return { items, lanes, dependencies, pack };
}

function cases(): Project[] {
  const random = makeRandom(SEED);
  return Array.from({ length: CASES }, (_, at) => generate(random, PACKS[at % PACKS.length] as PackMode));
}

// The seed is printed so a failure can be replayed (SDK_DEP_ROUTE_SEED).
// eslint-disable-next-line no-console
console.log(`[dep-routing] seed=${String(SEED)} cases=${String(CASES)}`);

function optionsFor(orientation: Orientation, mainSize: number): RouteOptions {
  const metrics = densityMetrics("comfortable", orientation);
  return {
    scale: createTimeScale([ORIGIN - 5 * DAY, ORIGIN + 110 * DAY], mainSize),
    crossInset: metrics.axisSize,
    crossOffset: 0,
    minItemMainSize: metrics.minItemMainSize,
  };
}

function layoutOf(project: Project, orientation: Orientation): ReturnType<typeof layoutItems> {
  const metrics = densityMetrics("comfortable", orientation);
  return layoutItems(project.items, {
    lanes: project.lanes,
    packMode: project.pack,
    metrics: { rowSize: metrics.rowSize, rowGap: metrics.rowGap, laneGap: metrics.laneGap },
  });
}

const facing = { start: -1, end: 1 } as const;

function segmentsOf(points: readonly MainCross[]): [MainCross, MainCross][] {
  const out: [MainCross, MainCross][] = [];
  for (let at = 1; at < points.length; at += 1) out.push([points[at - 1] as MainCross, points[at] as MainCross]);
  return out;
}

function findLayer(scene: SceneElement, name: string): number {
  return (scene.children ?? []).findIndex((child) => String(child.attrs?.class ?? "").includes(`tl-layer--${name}`));
}

describeBothOrientations("dependency routes", (orientation) => {
  it("[claim:type-edges] every route leaves and lands on the edges its type names, facing the right way", () => {
    let checked = 0;
    for (const project of cases()) {
      const options = optionsFor(orientation, 1200);
      const layout = layoutOf(project, orientation);
      for (const route of routeDependencies(layout, project.dependencies, options)) {
        const edges = dependencyEdges(route.type);
        const from = taskBox(layout.items.find((placed) => placed.item.id === route.dependency.from) as LayoutItem, options);
        const to = taskBox(layout.items.find((placed) => placed.item.id === route.dependency.to) as LayoutItem, options);
        const first = route.points[0] as MainCross;
        const second = route.points[1] as MainCross;
        const last = route.points[route.points.length - 1] as MainCross;
        const beforeLast = route.points[route.points.length - 2] as MainCross;
        expect(first).toEqual(edgePoint(from, edges.from));
        expect(last).toEqual(edgePoint(to, edges.to));
        // Out of an edge along time, the way the edge faces.
        expect(second.cross).toBe(first.cross);
        expect(Math.sign(second.main - first.main)).toBe(facing[edges.from]);
        // Into an edge along time, moving the way into it: into a start
        // forward, into an end backward.
        expect(beforeLast.cross).toBe(last.cross);
        expect(Math.sign(last.main - beforeLast.main)).toBe(-facing[edges.to]);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(500);
  });

  it("[claim:orthogonal] every segment runs along one axis", () => {
    for (const project of cases()) {
      const options = optionsFor(orientation, 1200);
      for (const route of routeDependencies(layoutOf(project, orientation), project.dependencies, options)) {
        for (const [a, b] of segmentsOf(route.points)) {
          expect(a.main === b.main || a.cross === b.cross).toBe(true);
          expect(a.main === b.main && a.cross === b.cross).toBe(false);
        }
      }
    }
  });

  it("[claim:under-items] the arrows' layer comes before the item layer, with its transform", () => {
    const random = makeRandom(SEED + 1);
    for (let at = 0; at < 20; at += 1) {
      const project = generate(random, PACKS[at % PACKS.length] as PackMode);
      const width = orientation === "horizontal" ? 1000 : 400;
      const height = orientation === "horizontal" ? 400 : 1000;
      const mainSize = orientation === "horizontal" ? width : height;
      const domain: [number, number] = [ORIGIN - 5 * DAY, ORIGIN + 110 * DAY];
      const spaces = [undefined, planSceneSpace(undefined, { domain, mainSize }, { settle: true })];
      for (const space of spaces) {
        const frame = renderTimeline({
          items: project.items,
          lanes: project.lanes,
          packMode: project.pack,
          domain,
          width,
          height,
          orientation,
          ...(space === undefined ? {} : { space }),
        });
        const routes = routeDependencies(frame.layout, project.dependencies, optionsFor(orientation, mainSize));
        // A path each, and a path per look — what the element draws.
        for (const nodes of [dependencyNodes(routes, orientation), dependencyPaths(routes, orientation)]) {
          const scene = withDependencyLayer(frame.scene, nodes);
          const deps = findLayer(scene, "deps");
          const items = findLayer(scene, "items");
          expect(deps).toBeGreaterThanOrEqual(0);
          expect(deps).toBe(items - 1);
          const children = scene.children ?? [];
          expect(children[deps]?.attrs?.transform).toBe(children[items]?.attrs?.transform);
          expect(children[deps]?.attrs?.["aria-hidden"]).toBe("true");
          const drawn = (children[deps]?.children ?? []).flatMap((node) => String(node.attrs?.["data-tl-dep"]).split(" "));
          expect(drawn.sort()).toEqual(routes.map((route) => route.id).sort());
        }
      }
    }
  });

  it("[claim:cull-keeps-visible] culling keeps every route with a segment in the clip, and drops some without", () => {
    let dropped = 0;
    let kept = 0;
    for (const project of cases()) {
      const options = optionsFor(orientation, 1200);
      const layout = layoutOf(project, orientation);
      const all = routeDependencies(layout, project.dependencies, options);
      // The cross range in rows, not pixels: a vertical row is six times a
      // horizontal one, and a fixed [40, 160] lies above every vertical route.
      const metrics = densityMetrics("comfortable", orientation);
      const clip = { main: [300, 700] as const, cross: [metrics.axisSize + 0.5 * metrics.rowSize, metrics.axisSize + 5 * metrics.rowSize] as const };
      const culled = new Set(routeDependencies(layout, project.dependencies, { ...options, clip }).map((route) => route.id));
      for (const route of all) {
        const visible = segmentsOf(route.points).some(([a, b]) => {
          const main0 = Math.min(a.main, b.main);
          const main1 = Math.max(a.main, b.main);
          const cross0 = Math.min(a.cross, b.cross);
          const cross1 = Math.max(a.cross, b.cross);
          return main1 >= clip.main[0] && main0 <= clip.main[1] && cross1 >= clip.cross[0] && cross0 <= clip.cross[1];
        });
        if (visible) {
          expect(culled.has(route.id), `route ${route.id} crosses the clip and was culled`).toBe(true);
          kept += 1;
        }
        // A route kept with no segment in the clip is allowed (its box meets
        // it); a culling that kept everything would prove nothing, so count
        // what was left out.
        if (!culled.has(route.id)) dropped += 1;
      }
    }
    expect(kept).toBeGreaterThan(100);
    expect(dropped).toBeGreaterThan(100);
  });
});

describe("dependency routes, by hand", () => {
  const box = (main: number, mainSize: number, cross: number) => ({ main, mainSize, cross, crossSize: 20 });

  it("routes a finish-to-start with room straight down and in", () => {
    expect(routePoints(box(0, 100, 0), box(200, 50, 40), { type: "FS", stub: 8, rowGap: 4 })).toEqual([
      { main: 100, cross: 10 },
      { main: 108, cross: 10 },
      { main: 108, cross: 50 },
      { main: 200, cross: 50 },
    ]);
  });

  it("turns a finish-to-start back through the gap when the successor starts earlier", () => {
    const points = routePoints(box(0, 100, 0), box(50, 50, 40), { type: "FS", stub: 8, rowGap: 4 });
    expect(points).toEqual([
      { main: 100, cross: 10 },
      { main: 108, cross: 10 },
      { main: 108, cross: 22 },
      { main: 42, cross: 22 },
      { main: 42, cross: 50 },
      { main: 50, cross: 50 },
    ]);
  });

  it("does not double a same-row start-to-start back on itself", () => {
    const points = routePoints(box(100, 50, 0), box(200, 50, 0), { type: "SS", stub: 8, rowGap: 4 });
    expect(points[1]).toEqual({ main: 92, cross: 10 });
    expect(points[points.length - 1]).toEqual({ main: 200, cross: 10 });
    expect(points.length).toBeGreaterThan(3);
  });

  it("leaves out a dependency on an unknown item or on itself, and names one by its ends", () => {
    const layout = layoutItems([{ id: "a", start: ORIGIN, end: ORIGIN + DAY }]);
    const options = { scale: createTimeScale([ORIGIN, ORIGIN + 10 * DAY], 1000) };
    expect(routeDependencies(layout, [{ from: "a", to: "b" }, { from: "a", to: "a" }], options)).toEqual([]);
    expect(dependencyId({ from: "a", to: "b" })).toBe("a->b");
  });

  it("draws a path with an open head at its end, in both orientations", () => {
    const points = [{ main: 0, cross: 10 }, { main: 50, cross: 10 }];
    expect(routePath(points, "horizontal")).toBe("M0 10 L50 10 M45 6.5 L50 10 L45 13.5");
    expect(routePath(points, "vertical")).toBe("M10 0 L10 50 M6.5 45 L10 50 L13.5 45");
  });

  it("marks the arrows of a selected item", () => {
    const route = { id: "d", dependency: { from: "a", to: "b" }, type: "FS", points: [{ main: 0, cross: 0 }, { main: 10, cross: 0 }] } as unknown as DependencyRoute;
    const [node] = dependencyNodes([route], "horizontal", { selectedIds: new Set(["b"]) });
    expect(node?.attrs?.class).toContain("tl-dep--selected");
  });
});
