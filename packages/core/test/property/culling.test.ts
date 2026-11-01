/**
 * Culling never hides what is on screen, and never draws what is far off it.
 *
 * Two halves of one claim, and both are needed. A culler that drew everything
 * would pass the first; one that drew nothing would pass the second. Together
 * they pin the node set to the viewport and its margin — in both
 * orientations, with the lanes scrolled anywhere, and with or without a scene
 * space. In a space the frame is drawn for the space's extent, rounded out to
 * whole tiles, so "far off" there means beyond the extent by more than a
 * tile; and the viewport must still be covered, whatever the extent.
 *
 * "On screen" is computed here from the layout and a fresh time scale, not
 * read back from the renderer: a property that asked the renderer what is
 * visible would be checking the culler against itself.
 */

import { afterAll, describe, it } from "vitest";

import { densityMetrics } from "../../src/density.js";
import { containerExtents } from "../../src/geometry.js";
import { itemRect } from "../../src/layout.js";
import { renderTimeline } from "../../src/render.js";
import { createTimeScale } from "../../src/scale.js";
import type { SceneElement } from "../../src/scene.js";
import type { Density, Orientation } from "../../src/types.js";
import { forAll, generateCase, writePropertyReport } from "./harness.js";
import type { GeneratedCase } from "./harness.js";

const DAY = 86_400_000;
const ORIGIN = Date.UTC(2020, 0, 1);
const CASES = 600;
const ORIENTATIONS: readonly Orientation[] = ["horizontal", "vertical"];
const DENSITIES: readonly Density[] = ["comfortable", "compact", "dense"];

interface View {
  readonly orientation: Orientation;
  readonly density: Density;
  readonly domain: readonly [number, number];
  readonly width: number;
  readonly height: number;
  readonly crossOffset: number;
  readonly spaced: boolean;
  readonly spaceShift: number;
  readonly spaceStretch: number;
  /** How far the extent reaches past each viewport edge, in viewports. */
  readonly reachBefore: number;
  readonly reachAfter: number;
}

type Step = View;

function generate(random: () => number): GeneratedCase<Step> {
  const base = generateCase(random, { open: true, tall: true, granularity: true, lanes: 4 });
  const start = ORIGIN + Math.floor(random() * 300) * DAY;
  const view: View = {
    orientation: ORIENTATIONS[Math.floor(random() * 2)] as Orientation,
    density: DENSITIES[Math.floor(random() * 3)] as Density,
    domain: [start, start + Math.floor(5 + random() * 200) * DAY],
    width: 200 + Math.floor(random() * 900),
    height: 120 + Math.floor(random() * 500),
    crossOffset: random() < 0.5 ? 0 : Math.floor(random() * 300),
    spaced: random() < 0.5,
    spaceShift: (random() - 0.5) * 2000,
    spaceStretch: 0.67 + random() * 0.83,
    reachBefore: random() < 0.3 ? 0 : random() * 1.5,
    reachAfter: random() < 0.3 ? 0 : random() * 1.5,
  };
  // The view travels as the single step, so a shrunk counterexample keeps
  // the viewport it failed in.
  return { ...base, steps: [view] };
}

function itemsLayer(scene: SceneElement): readonly SceneElement[] {
  const layer = (scene.children ?? []).find(
    (child) => child.attrs?.class === "tl-layer tl-layer--items",
  );
  // In a space the items sit in tile groups.
  return (layer?.children ?? []).flatMap((node) =>
    node.attrs?.["data-tl-tile"] === undefined ? [node] : (node.children ?? []),
  );
}

function extentOf(view: View): readonly [number, number] {
  const span = view.domain[1] - view.domain[0];
  return [view.domain[0] - span * view.reachBefore, view.domain[1] + span * view.reachAfter];
}

function check(generated: GeneratedCase<Step>): string | undefined {
  const view = generated.steps?.[0];
  if (view === undefined) {
    return undefined;
  }
  const { mainSize, crossSize } = containerExtents(view.width, view.height, view.orientation);
  const metrics = densityMetrics(view.density, view.orientation);
  const scale = createTimeScale(view.domain, mainSize);
  const result = renderTimeline({
    items: generated.items,
    ...(generated.lanes === undefined ? {} : { lanes: generated.lanes }),
    domain: view.domain,
    width: view.width,
    height: view.height,
    orientation: view.orientation,
    density: view.density,
    crossOffset: view.crossOffset,
    ...(view.spaced
      ? {
          space: {
            origin: view.domain[0] + view.spaceShift * scale.msPerPx,
            msPerPx: scale.msPerPx * view.spaceStretch,
            extent: extentOf(view),
          },
        }
      : {}),
  });
  const drawn = new Set(itemsLayer(result.scene).map((node) => String(node.attrs?.["data-tl-id"])));
  const margin = metrics.rowSize;
  for (const placed of result.layout.items) {
    const rect = itemRect(placed, scale);
    const from = rect.main;
    const to = rect.main + Math.max(rect.mainSize, metrics.minItemMainSize);
    const crossFrom = rect.cross + metrics.axisSize - view.crossOffset;
    const crossTo = crossFrom + rect.crossSize;
    const onScreen =
      to > 0 && from < mainSize && crossTo > metrics.axisSize && crossFrom < crossSize;
    const crossNear = crossTo > metrics.axisSize && crossFrom < crossSize + margin;
    let nearScreen = to > -margin && from < mainSize + margin && crossNear;
    if (view.spaced) {
      // In the space's own pixels: the extent, a tile either side, the margin.
      const spaceMsPerPx = scale.msPerPx * view.spaceStretch;
      const tile = mainSize / 4;
      const [extentStart, extentEnd] = extentOf(view);
      const low = extentStart - (tile + margin) * spaceMsPerPx;
      const high = extentEnd + tile * spaceMsPerPx;
      const start = placed.span.start;
      const end = placed.span.open ? Number.POSITIVE_INFINITY : Math.max(placed.span.end, start + metrics.minItemMainSize * spaceMsPerPx);
      nearScreen = end > low && start < high && crossNear;
    }
    const id = placed.item.id;
    if (onScreen && !drawn.has(id)) {
      return `"${id}" is on screen (main ${from.toFixed(1)}..${to.toFixed(1)}, cross ${crossFrom.toFixed(1)}..${crossTo.toFixed(1)}) but was culled (${view.orientation})`;
    }
    if (!nearScreen && drawn.has(id)) {
      return `"${id}" is beyond the margin (main ${from.toFixed(1)}..${to.toFixed(1)}, cross ${crossFrom.toFixed(1)}..${crossTo.toFixed(1)}) but was drawn (${view.orientation})`;
    }
  }
  if (drawn.size !== result.visibleCount) {
    return `visibleCount says ${String(result.visibleCount)}, the layer holds ${String(drawn.size)}`;
  }
  return undefined;
}

describe("culling properties", () => {
  it("never culls an item on screen, and never draws one beyond the margin", () => {
    forAll("culling never hides a visible item", CASES, 0xc011, generate, check);
  });
});

afterAll(() => {
  writePropertyReport("culling");
});
