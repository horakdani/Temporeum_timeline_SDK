/**
 * The projector: the one place that knows about screen coordinates.
 *
 * Everything else in the engine — layout, collision, hit testing, culling,
 * clustering — works in `(main, cross)` space, where `main` runs along the
 * time axis and `cross` across the lanes. This file turns that into `x`/`y`
 * and back, and it is the only file that is allowed to.
 *
 * Horizontal: `main` is x, `cross` is y. Vertical: `main` is y, `cross` is x.
 * A vertical timeline is therefore the same code path as a horizontal one
 * rather than a second implementation, and every geometric test runs in both
 * orientations to keep it that way.
 */

import type { MainCross, MainCrossRect, Orientation } from "./types.js";

/** Both orientations, as the single source of truth for the test harness. */
export const ORIENTATIONS: readonly Orientation[] = ["horizontal", "vertical"];

/** A point in CSS pixels, relative to the container's top-left corner. */
export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

/** A box in CSS pixels, relative to the container's top-left corner. */
export interface ScreenRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Which screen axis time flows along. */
export function mainAxisOf(orientation: Orientation): "x" | "y" {
  return orientation === "horizontal" ? "x" : "y";
}

/** Which screen axis the lanes stack along. */
export function crossAxisOf(orientation: Orientation): "x" | "y" {
  return orientation === "horizontal" ? "y" : "x";
}

/** `(main, cross)` to screen pixels. */
export function projectPoint(point: MainCross, orientation: Orientation): ScreenPoint {
  return orientation === "horizontal"
    ? { x: point.main, y: point.cross }
    : { x: point.cross, y: point.main };
}

/** Screen pixels back to `(main, cross)`. */
export function unprojectPoint(point: ScreenPoint, orientation: Orientation): MainCross {
  return orientation === "horizontal"
    ? { main: point.x, cross: point.y }
    : { main: point.y, cross: point.x };
}

/** `(main, cross)` box to screen pixels. */
export function projectRect(rect: MainCrossRect, orientation: Orientation): ScreenRect {
  return orientation === "horizontal"
    ? { x: rect.main, y: rect.cross, width: rect.mainSize, height: rect.crossSize }
    : { x: rect.cross, y: rect.main, width: rect.crossSize, height: rect.mainSize };
}

/** Screen box back to `(main, cross)`. */
export function unprojectRect(rect: ScreenRect, orientation: Orientation): MainCrossRect {
  return orientation === "horizontal"
    ? { main: rect.x, cross: rect.y, mainSize: rect.width, crossSize: rect.height }
    : { main: rect.y, cross: rect.x, mainSize: rect.height, crossSize: rect.width };
}

/** An orientation with the four projections bound to it. */
export interface Projector {
  readonly orientation: Orientation;
  readonly mainAxis: "x" | "y";
  readonly crossAxis: "x" | "y";
  projectPoint(point: MainCross): ScreenPoint;
  unprojectPoint(point: ScreenPoint): MainCross;
  projectRect(rect: MainCrossRect): ScreenRect;
  unprojectRect(rect: ScreenRect): MainCrossRect;
}

/**
 * A projector for one orientation.
 *
 * The free functions above are the hot path; this is the convenient form for
 * a renderer that holds one orientation for the lifetime of a frame.
 */
export function createProjector(orientation: Orientation): Projector {
  return {
    orientation,
    mainAxis: mainAxisOf(orientation),
    crossAxis: crossAxisOf(orientation),
    projectPoint: (point) => projectPoint(point, orientation),
    unprojectPoint: (point) => unprojectPoint(point, orientation),
    projectRect: (rect) => projectRect(rect, orientation),
    unprojectRect: (rect) => unprojectRect(rect, orientation),
  };
}

/**
 * Container size in `(main, cross)` terms.
 *
 * The caller measures a width and a height; the engine wants a main extent
 * and a cross extent, and which is which depends on the orientation. One
 * helper here is cheaper than the same ternary in every call site.
 */
export function containerExtents(
  width: number,
  height: number,
  orientation: Orientation,
): { readonly mainSize: number; readonly crossSize: number } {
  return orientation === "horizontal"
    ? { mainSize: width, crossSize: height }
    : { mainSize: height, crossSize: width };
}
