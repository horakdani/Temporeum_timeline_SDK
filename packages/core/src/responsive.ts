/**
 * Responsiveness: the decisions a timeline makes from the size of its box and
 * the hand that is pointing at it.
 *
 * A responsive timeline is not the same timeline smaller — it is a different
 * projection (`api_terv` §8). This file holds every decision that turns a
 * measurement into one: which way time runs, how dense the drawing is, where
 * an item's details open, and how large a target a finger gets. They are pure
 * functions, so the same measurement gives the same answer in Node, in a test
 * and in a browser, and a host that measures its own way (a canvas, a
 * server-side render, a Web Component) gets the identical decisions.
 *
 * Two properties are deliberate and worth defending:
 *
 * - **Hysteresis wherever the answer changes what is being measured.** A
 *   new orientation changes the content's height, which can add or remove a
 *   page scrollbar, which moves the width that chose the orientation by 15–17
 *   pixels. Without a band around the breakpoint a `ResizeObserver` would
 *   flip it back and forth forever. The same holds, more mildly, for density
 *   under a pinch.
 * - **Every decision returns its reasons.** {@link fitDensity} reports what
 *   each criterion said, so "why is it dense?" is answered by the library,
 *   not by a host reverse-engineering thresholds.
 */

import { DENSITIES, densityMetrics } from "./density.js";
import type { MetricsProvider } from "./density.js";
import type { ScreenRect } from "./geometry.js";
import { containerExtents } from "./geometry.js";
import { layoutItems } from "./layout.js";
import { toTimeMs } from "./time.js";
import type {
  Density,
  DensitySetting,
  DetailSurface,
  DetailSurfaceSetting,
  Item,
  Lane,
  Orientation,
  OrientationSetting,
  PackMode,
  PointerKind,
  TimeInput,
} from "./types.js";

/** Container width below which `orientation: "auto"` turns vertical. */
export const DEFAULT_BREAKPOINT = 640;

/**
 * How far below the breakpoint a horizontal timeline has to shrink before it
 * turns vertical. Wider than any desktop scrollbar (15–17 px), so the
 * scrollbar a vertical layout brings with it cannot undo the decision.
 */
export const ORIENTATION_HYSTERESIS = 24;

/** Relative band around each density threshold on the main axis. */
export const DENSITY_HYSTERESIS = 0.15;

/** Hit slop, per side, for a precise pointer: a mouse or a pen. */
export const HIT_SLOP_FINE = 4;

/** Hit slop, per side, for a finger. */
export const HIT_SLOP_COARSE = 12;

/**
 * Smallest target, in each axis, at the `dense` level — WCAG 2.2 success
 * criterion 2.5.8 (Target Size, Minimum). Dense items are dots and strokes,
 * and that is exactly where an undersized target stops being usable.
 */
export const DENSE_MIN_TARGET = 24;

// ---------------------------------------------------------------------------
// Orientation
// ---------------------------------------------------------------------------

/** What {@link resolveOrientation} needs besides the setting and the width. */
export interface OrientationOptions {
  /** Width at and above which `auto` is horizontal. */
  readonly breakpoint?: number;
  /** The orientation currently on screen; enables the hysteresis band. */
  readonly previous?: Orientation;
  /** Band below the breakpoint a horizontal timeline is allowed to keep. */
  readonly hysteresis?: number;
}

/**
 * The orientation for a container width.
 *
 * `auto` is horizontal at or above the breakpoint and vertical below it: on a
 * phone the native gesture is the vertical scroll, and in a vertical timeline
 * every item gets the full screen width for its label. An explicit setting is
 * returned as is — the host's word beats the measurement.
 *
 * A container with no width (a hidden tab, a collapsed panel, the frame
 * before layout) keeps what is on screen: deciding from zero would flip every
 * hidden timeline vertical and back again when it is shown.
 */
export function resolveOrientation(
  setting: OrientationSetting | undefined,
  width: number,
  options: OrientationOptions = {},
): Orientation {
  if (setting !== undefined && setting !== "auto") {
    return setting;
  }
  const previous = options.previous;
  if (!(width > 0)) {
    return previous ?? "horizontal";
  }
  const breakpoint = options.breakpoint ?? DEFAULT_BREAKPOINT;
  if (previous === "horizontal") {
    return width >= breakpoint - (options.hysteresis ?? ORIENTATION_HYSTERESIS)
      ? "horizontal"
      : "vertical";
  }
  return width >= breakpoint ? "horizontal" : "vertical";
}

// ---------------------------------------------------------------------------
// Density
// ---------------------------------------------------------------------------

/** Everything the automatic density is decided from. */
export interface DensityFitInput<T = unknown> {
  readonly items: readonly Item<T>[];
  readonly lanes?: readonly Lane[];
  readonly packMode?: PackMode;
  readonly timeZone?: string;
  readonly domain: readonly [TimeInput, TimeInput];
  /** Container width in CSS pixels. */
  readonly width: number;
  /** Container height in CSS pixels. */
  readonly height: number;
  readonly orientation: Orientation;
  /** The density currently on screen; enables the hysteresis band. */
  readonly previous?: Density;
  /** The sizes each level draws with, as the renderer reads them (`RenderOptions.metrics`). */
  readonly metrics?: MetricsProvider;
}

/** The automatic density, with the reasons it was chosen. */
export interface DensityFit {
  /** The denser of the two criteria. */
  readonly density: Density;
  /** The coarsest level at which every lane fits across the container. */
  readonly byCross: Density;
  /** The coarsest level the typical item's length along time allows. */
  readonly byMain: Density;
  /**
   * Median drawn main extent of the visible items, in CSS pixels — the
   * "pixels per unit of time" the plan speaks of, measured in the items' own
   * units. `undefined` when nothing is visible.
   */
  readonly typicalMainSize: number | undefined;
  /** Cross extent the content would need at each level, axis included. */
  readonly contentCrossSize: Readonly<Record<Density, number>>;
}

function densityIndex(density: Density): number {
  return DENSITIES.indexOf(density);
}

function denserOf(a: Density, b: Density): Density {
  return densityIndex(a) >= densityIndex(b) ? a : b;
}

function median(values: readonly number[]): number | undefined {
  if (values.length === 0) {
    return undefined;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  // Both reads are in range: `sorted` is non-empty and `middle` indexes it.
  const upper = sorted[middle] as number;
  return sorted.length % 2 === 1 ? upper : ((sorted[middle - 1] as number) + upper) / 2;
}

/**
 * The density the measurement allows, coarsest first.
 *
 * Two criteria, and the denser one wins, because either running out of room
 * is enough to make a level unreadable:
 *
 * 1. **Across the lanes.** The coarsest level at which the whole layout fits
 *    the container's cross extent. The layout is the engine's own
 *    {@link layoutItems}, run once per level — the layout is zoom-independent
 *    and cheap, and a second formula for "how tall would it be" is a second
 *    formula that can disagree with the renderer. When even `dense` does not
 *    fit, the answer is `dense` and the lanes scroll.
 * 2. **Along time.** The median drawn length of the visible items against
 *    each level's {@link DensityMetrics.autoMainRoom}. The median, not the
 *    shortest: one instant among weeks should not take everybody's labels
 *    away. A band of {@link DENSITY_HYSTERESIS} around each threshold keeps a
 *    pinch at the boundary from flickering the level frame by frame.
 *
 * A container with no extent keeps what is on screen, for the same reason
 * {@link resolveOrientation} does.
 */
export function fitDensity<T>(input: DensityFitInput<T>): DensityFit {
  const { mainSize, crossSize } = containerExtents(input.width, input.height, input.orientation);
  const previous = input.previous;

  const needs: Record<Density, number> = { comfortable: 0, compact: 0, dense: 0 };
  let spans: readonly { readonly start: number; readonly end: number }[] = [];
  for (const density of DENSITIES) {
    const metrics = (input.metrics ?? densityMetrics)(density, input.orientation);
    const layout = layoutItems(input.items, {
      ...(input.lanes === undefined ? {} : { lanes: input.lanes }),
      ...(input.packMode === undefined ? {} : { packMode: input.packMode }),
      ...(input.timeZone === undefined ? {} : { timeZone: input.timeZone }),
      metrics: { rowSize: metrics.rowSize, rowGap: metrics.rowGap, laneGap: metrics.laneGap },
    });
    // The same sum the renderer reports as `contentCrossSize`: the axis band
    // comes first, the lanes after it.
    needs[density] = metrics.axisSize + layout.crossSize;
    // Spans do not depend on the level; any of the three layouts has them,
    // resolved the way the renderer draws them — a day-granular instant
    // counts with the day it covers, not as a point.
    spans = layout.items.map((placed) => placed.span);
  }

  if (!(mainSize > 0) || !(crossSize > 0)) {
    const kept = previous ?? "comfortable";
    return {
      density: kept,
      byCross: kept,
      byMain: kept,
      typicalMainSize: undefined,
      contentCrossSize: needs,
    };
  }

  const byCross = DENSITIES.find((density) => needs[density] <= crossSize) ?? "dense";

  const start = toTimeMs(input.domain[0]);
  const end = toTimeMs(input.domain[1]);
  const pxPerMs = mainSize / (end - start);
  const lengths: number[] = [];
  for (const span of spans) {
    const from = Math.max(span.start, start);
    const to = Math.min(span.end, end);
    if (to <= start || from >= end) {
      continue;
    }
    lengths.push((to - from) * pxPerMs);
  }
  const typical = median(lengths);

  let byMain: Density = "dense";
  if (typical === undefined) {
    byMain = "comfortable";
  } else {
    for (const density of DENSITIES) {
      // The host's metrics, as for the cross axis above.
      const room = (input.metrics ?? densityMetrics)(density, input.orientation).autoMainRoom;
      // Coarser than what is shown has to clear the band; what is shown may
      // sag into it. A denser level is measured plainly: it is never the one
      // being held.
      let factor = 1;
      if (previous !== undefined) {
        if (density === previous) {
          factor = 1 - DENSITY_HYSTERESIS;
        } else if (densityIndex(density) < densityIndex(previous)) {
          factor = 1 + DENSITY_HYSTERESIS;
        }
      }
      if (typical >= room * factor) {
        byMain = density;
        break;
      }
    }
  }

  return {
    density: denserOf(byCross, byMain),
    byCross,
    byMain,
    typicalMainSize: typical,
    contentCrossSize: needs,
  };
}

/** The density to draw with: the host's explicit level, or the fitted one. */
export function resolveDensity(setting: DensitySetting | undefined, fit: DensityFit): Density {
  return setting === undefined || setting === "auto" ? fit.density : setting;
}

// ---------------------------------------------------------------------------
// Detail surface
// ---------------------------------------------------------------------------

/** How an item's details are reached. */
export type DetailTrigger = "hover" | "tap";

/** Where an item's details open, and what opens them. */
export interface DetailSurfaceChoice {
  readonly surface: DetailSurface;
  readonly trigger: DetailTrigger;
}

/** What {@link resolveDetailSurface} decides from. */
export interface DetailSurfaceInput {
  /** The pointer that is about to ask; `undefined` before any has. */
  readonly pointerType?: PointerKind;
  readonly density: Density;
  /** Container width in CSS pixels. */
  readonly width: number;
  readonly breakpoint?: number;
}

/**
 * Where an item's details open.
 *
 * `auto`: a mouse at a roomy level gets a popover on hover; a finger or a pen
 * gets a popover on tap, because hover does not exist for it; a narrow
 * container or the `dense` level gets a bottom **sheet**, because at 375
 * pixels a popover covers exactly the thing being looked at. A sheet always
 * opens on tap — a sheet sliding up on hover would be a page that moves under
 * the mouse.
 *
 * Resolved per pointer, like the drag trigger: on a hybrid laptop the mouse
 * hovers and the finger taps in the same session.
 */
export function resolveDetailSurface(
  setting: DetailSurfaceSetting | undefined,
  input: DetailSurfaceInput,
): DetailSurfaceChoice {
  const hovering = input.pointerType === undefined || input.pointerType === "mouse";
  const narrow = input.width < (input.breakpoint ?? DEFAULT_BREAKPOINT);
  const surface: DetailSurface =
    setting !== undefined && setting !== "auto"
      ? setting
      : narrow || input.density === "dense"
        ? "sheet"
        : "popover";
  return { surface, trigger: surface === "popover" && hovering ? "hover" : "tap" };
}

/** Which side of its anchor a popover ended up on. */
export type PopoverSide = "below" | "above";

/** A placed popover, in the same space as its anchor and bounds. */
export interface PopoverPlacement extends ScreenRect {
  readonly side: PopoverSide;
}

/** Tuning for {@link placePopover}. */
export interface PopoverOptions {
  /** Distance between the anchor and the popover. */
  readonly gap?: number;
  /** Distance kept from every edge of the bounds. */
  readonly margin?: number;
}

/**
 * Place a popover next to an anchor, inside the bounds.
 *
 * This is the one function in this file that works in page `x`/`y` rather
 * than `(main, cross)`: a popover is placed *after* projection, in the page,
 * and the page does not rotate with the timeline.
 *
 * Below the anchor if it fits, above if that fits, otherwise on whichever
 * side has more room. Centred on the anchor along the other axis and clamped
 * to the bounds, and never wider than the bounds — a popover that sticks out
 * of the viewport is a horizontal page scroll, which is the one thing a
 * responsive widget must never cause.
 */
export function placePopover(
  anchor: ScreenRect,
  size: { readonly width: number; readonly height: number },
  bounds: { readonly width: number; readonly height: number },
  options: PopoverOptions = {},
): PopoverPlacement {
  const gap = options.gap ?? 8;
  const margin = options.margin ?? 8;
  const width = Math.max(0, Math.min(size.width, bounds.width - 2 * margin));
  const height = size.height;
  const centred = anchor.x + anchor.width / 2 - width / 2;
  const x = Math.min(Math.max(centred, margin), Math.max(margin, bounds.width - margin - width));

  const roomBelow = bounds.height - margin - (anchor.y + anchor.height + gap);
  const roomAbove = anchor.y - gap - margin;
  let side: PopoverSide = roomBelow >= roomAbove ? "below" : "above";
  if (height <= roomBelow) {
    side = "below";
  } else if (height <= roomAbove) {
    side = "above";
  }
  const y =
    side === "below"
      ? anchor.y + anchor.height + gap
      : Math.max(margin, anchor.y - gap - height);
  return { x, y, width, height, side };
}

// ---------------------------------------------------------------------------
// Target size
// ---------------------------------------------------------------------------

/**
 * The hit slop, per side, for a pointer.
 *
 * A precise pointer gets {@link HIT_SLOP_FINE}, a finger
 * {@link HIT_SLOP_COARSE}. An unknown pointer gets none, and no dense
 * minimum either: the zone grows only when the library knows what is aiming,
 * so a host's own programmatic hit test keeps exact geometry.
 *
 * At the `dense` level a known pointer's zone is further raised per axis by
 * {@link slopForExtent}, so the target reaches {@link DENSE_MIN_TARGET}.
 */
export function hitSlopFor(pointerType: PointerKind | undefined): number {
  if (pointerType === undefined) {
    return 0;
  }
  return pointerType === "touch" ? HIT_SLOP_COARSE : HIT_SLOP_FINE;
}

/**
 * The slop along one axis of one item.
 *
 * Outside `dense` it is the pointer's own slop. At `dense` it is at least
 * what brings an `extent`-pixel item up to the minimum target — a 2-pixel
 * stroke gets 11 pixels each side, whatever is pointing at it.
 */
export function slopForExtent(base: number, extent: number, density: Density): number {
  if (density !== "dense") {
    return base;
  }
  return Math.max(base, (DENSE_MIN_TARGET - extent) / 2);
}
