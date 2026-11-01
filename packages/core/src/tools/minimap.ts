/**
 * The overview strip: the whole timeline at a glance, with the view as a
 * window on it that the reader drags.
 *
 * The strip runs along the time axis, across the far edge of the frame — the
 * bottom of a horizontal timeline, the right of a vertical one — and shows
 * the extent of the items and the view, in shown time when there are hidden
 * dates. Every way of moving the window is a pan of the view: a drag of the
 * window, a press beside it, an arrow with the window focused. They all end
 * in the core's `panDomainBy`, the function a drag on the timeline itself
 * ends in, so moving the window a distance is exactly panning the view by
 * what that distance stands for.
 */

import { rectAttrs } from "../draw.js";
import { createProjector } from "../geometry.js";
import type { Layout } from "../layout.js";
import { createTimeScale, panDomainBy } from "../scale.js";
import type { TimeScale, TimeWarp } from "../scale.js";
import type { SceneElement } from "../scene.js";
import type { Domain, Orientation } from "../types.js";
import { stepsOf } from "./keys.js";
import type { AxisKeyAction } from "./keys.js";

/** The strip's thickness across the axis when the host names none, in CSS pixels. */
export const DEFAULT_MINIMAP_SIZE = 36;

/** The narrowest the window is drawn, so a deep zoom still has something to grab. */
export const MIN_WINDOW_SIZE = 8;

/** A fraction of the view an arrow moves it by. */
export const MINIMAP_STEP = 0.1;

/** Where the strip is and what it shows. */
export interface MinimapGeometry {
  /** What the strip spans: the items and the view. */
  readonly extent: Domain;
  /** The strip's own scale: the extent over its length. */
  readonly scale: TimeScale;
  /** The view's window on the strip, along it. */
  readonly window: { readonly main: number; readonly mainSize: number };
  /** The main view's extent along the axis, which a pan is measured in. */
  readonly mainSize: number;
  readonly warp: TimeWarp | undefined;
}

/**
 * What the strip spans: every item and the view, with a fiftieth of a margin.
 * An open item counts from its start.
 */
export function minimapExtent(layout: Layout, domain: Domain): Domain {
  let start = domain[0];
  let end = domain[1];
  for (const placed of layout.items) {
    start = Math.min(start, placed.span.start);
    end = Math.max(end, placed.span.open ? placed.span.start : placed.span.end);
  }
  const margin = (end - start) / 50;
  return [start - margin, end + margin];
}

/** The strip for a view: its scale and the view's window on it. */
export function minimapGeometry(extent: Domain, domain: Domain, mainSize: number, warp?: TimeWarp): MinimapGeometry {
  const scale = createTimeScale(extent, mainSize, warp);
  const from = scale.toMain(domain[0]);
  const to = scale.toMain(domain[1]);
  const size = Math.max(to - from, MIN_WINDOW_SIZE);
  return { extent, scale, window: { main: Math.min(Math.max((from + to) / 2 - size / 2, 0), Math.max(mainSize - size, 0)), mainSize: size }, mainSize, warp };
}

/** Main-view pixels that `delta` strip pixels stand for, at `domain`'s zoom. */
function mainPixels(geometry: MinimapGeometry, domain: Domain, delta: number): number {
  const view = createTimeScale(domain, geometry.mainSize, geometry.warp);
  return (delta * geometry.scale.msPerPx) / view.msPerPx;
}

/**
 * The view after its window, grabbed at `grab` on the strip when the view
 * was `domain`, is dragged to `main` — the pan of the view by what the
 * distance stands for.
 */
export function minimapDragDomain(domain: Domain, grab: number, main: number, geometry: MinimapGeometry): Domain {
  return panDomainBy(domain, geometry.mainSize, mainPixels(geometry, domain, main - grab), geometry.warp);
}

/** The view centred on the instant under `main` on the strip: a press beside the window. */
export function minimapJumpDomain(domain: Domain, main: number, geometry: MinimapGeometry): Domain {
  const centre = geometry.window.main + geometry.window.mainSize / 2;
  return minimapDragDomain(domain, centre, main, geometry);
}

/**
 * The view after a key on the focused window: an arrow pans a tenth of the
 * view, a page a whole one, `Home` and `End` to the extent's ends.
 */
export function minimapKeyDomain(domain: Domain, action: AxisKeyAction, geometry: MinimapGeometry): Domain {
  const steps = stepsOf(action);
  if (steps !== undefined) {
    return panDomainBy(domain, geometry.mainSize, steps * geometry.mainSize * MINIMAP_STEP, geometry.warp);
  }
  const target = action === "first" ? 0 : geometry.mainSize - geometry.window.mainSize;
  return minimapDragDomain(domain, geometry.window.main, target, geometry);
}

/** How the strip is drawn. */
export interface MinimapDrawOptions {
  readonly orientation: Orientation;
  /** Where the strip starts across the axis: the frame's cross extent. */
  readonly cross: number;
  /** Its thickness. */
  readonly size: number;
}

/**
 * The strip as scene nodes: a background, the items as one path — a sliver
 * per item, at its row's height — and the window. Hidden from assistive
 * technology: what it says, the view's own range says; the element puts a
 * slider over the window for the keyboard and the screen reader.
 */
export function minimapNodes(layout: Layout, geometry: MinimapGeometry, options: MinimapDrawOptions): readonly SceneElement[] {
  const projector = createProjector(options.orientation);
  const { cross, size } = options;
  const inner = Math.max(size - 6, 1);
  const rows = Math.max(layout.rowCount, 1);
  const rowSize = Math.max(inner / rows, 1);
  const scale = geometry.scale;
  let d = "";
  for (const placed of layout.items) {
    const from = scale.toMain(placed.span.start);
    const to = placed.span.open ? scale.mainSize : scale.toMain(placed.span.end);
    if (to < 0 || from > scale.mainSize) continue;
    const box = projector.projectRect({ main: from, mainSize: Math.max(to - from, 1), cross: cross + 3 + (placed.row / rows) * inner, crossSize: rowSize });
    d += `M${round(box.x)} ${round(box.y)}h${round(box.width)}v${round(box.height)}h${round(-box.width)}z`;
  }
  return [
    { tag: "rect", attrs: { class: "tl-minimap", ...rectAttrs({ main: 0, mainSize: scale.mainSize, cross, crossSize: size }, projector) } },
    ...(d === "" ? [] : [{ tag: "path", attrs: { class: "tl-minimap-items", d } } satisfies SceneElement]),
    {
      tag: "rect",
      attrs: {
        class: "tl-minimap-window",
        "data-tl-minimap-window": "",
        ...rectAttrs({ main: geometry.window.main, mainSize: geometry.window.mainSize, cross: cross + 1, crossSize: size - 2 }, projector),
      },
    },
  ];
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/** The strip's stylesheet, for the frame's scope. */
export function minimapCss(scope: string): string {
  return (
    `${scope} .tl-minimap{fill:var(--tl-surface);stroke:var(--tl-line);stroke-width:1}` +
    `${scope} .tl-minimap-items{fill:var(--tl-item-fill);opacity:.55}` +
    `${scope} .tl-minimap-window{fill:var(--tl-accent);fill-opacity:.14;stroke:var(--tl-accent);stroke-width:1.5;cursor:grab}`
  );
}
