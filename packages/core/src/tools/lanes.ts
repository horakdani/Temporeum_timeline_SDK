/**
 * Sticky lane headers: each lane's name, held at the start of the view.
 *
 * A pan moves the items and leaves the names where they are, so a reader
 * deep in a long timeline still knows whose row they are reading; a lane
 * scrolled half under the axis band keeps its name at the top of what is
 * left of it. The names are drawn in the frame, not in the items' space:
 * nothing a pan rewrites. Hidden from assistive technology — every item's
 * accessible name already says its lane.
 */

import { densityMetrics } from "../density.js";
import type { MetricsProvider } from "../density.js";
import { textNode } from "../draw.js";
import { createProjector } from "../geometry.js";
import type { Layout } from "../layout.js";
import type { SceneElement } from "../scene.js";
import type { Density, Orientation } from "../types.js";

/** Where the headers go. */
export interface LaneHeaderOptions {
  readonly orientation: Orientation;
  readonly density: Density;
  /** The sizes the frame draws with (`RenderOptions.metrics`). */
  readonly metrics?: MetricsProvider | undefined;
  /** How far the lanes are scrolled across: the machine's `crossOffset`. */
  readonly crossOffset: number;
  /** The frame's cross extent. */
  readonly crossSize: number;
  /** A measurer for the label's width; an estimate when absent. */
  readonly measure?: (text: string) => number;
}

/** Each lane with a label, its name at the view's start, while any of the lane is in view. */
export function laneHeaderNodes(layout: Layout, options: LaneHeaderOptions): readonly SceneElement[] {
  const metrics = (options.metrics ?? densityMetrics)(options.density, options.orientation);
  const projector = createProjector(options.orientation);
  const inset = metrics.axisSize;
  const height = metrics.lineHeight + metrics.labelPadding;
  const nodes: SceneElement[] = [];
  for (const laid of layout.lanes) {
    const label = laid.lane.label;
    if (label === undefined || label === "") continue;
    const from = laid.cross + inset - options.crossOffset;
    const to = from + laid.crossSize;
    if (to <= inset || from >= options.crossSize) continue;
    // Held at the top of what is left of the lane, and not past its end.
    const cross = Math.min(Math.max(from, inset), to - height);
    if (cross < inset - height / 2) continue;
    const width = (options.measure?.(label) ?? label.length * metrics.fontSize * 0.6) + 2 * metrics.labelPadding;
    nodes.push({
      tag: "g",
      attrs: { class: "tl-lane-header", "data-tl-lane-header": laid.lane.id },
      children: [
        {
          tag: "rect",
          attrs: { class: "tl-lane-header-bg", ...projector.projectRect({ main: 0, mainSize: width, cross, crossSize: height }), rx: 3 },
        },
        textNode({ main: 0, mainSize: width, cross, crossSize: height }, label, projector, "tl-lane-header-text", metrics.labelPadding),
      ],
    });
  }
  return nodes;
}

/**
 * The headers' layer, over the labels and under the foreground: a pan
 * rewrites none of it. Emitted empty too, as the renderer's own layers are,
 * so frames keep one node structure.
 */
export function withLaneHeaderLayer(scene: SceneElement, nodes: readonly SceneElement[]): SceneElement {
  const children = scene.children ?? [];
  const at = children.findIndex((child) => child.tag === "g" && String(child.attrs?.class ?? "").includes("tl-layer--foreground"));
  const layer: SceneElement = { tag: "g", attrs: { class: "tl-layer tl-layer--lane-headers", "aria-hidden": "true" }, children: nodes };
  return { ...scene, children: at === -1 ? [...children, layer] : [...children.slice(0, at), layer, ...children.slice(at)] };
}

/** The headers' stylesheet, for the frame's scope. */
export function laneHeaderCss(scope: string): string {
  return (
    `${scope} .tl-lane-header-bg{fill:var(--tl-surface);fill-opacity:.88;stroke:var(--tl-line)}` +
    `${scope} .tl-lane-header-text{fill:var(--tl-text);font-weight:600}`
  );
}
