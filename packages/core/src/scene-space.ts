/**
 * When to keep the space, when to grow what is drawn in it, and when to
 * re-anchor it.
 *
 * The renderer can draw a frame in a stable space and map it onto the
 * viewport with one transform per layer ({@link SceneSpace}). That is what
 * makes a pan or a zoom frame cheap: everything already drawn keeps its
 * attributes, and a frame inside the drawn extent writes nothing but the
 * transforms. It is also, while the space's scale differs from the
 * viewport's, a stretched picture. This file is the one place that decides
 * how much stretch is acceptable and how far past the viewport to draw — a
 * pure function, so the decisions are tested here and not rediscovered in
 * every host.
 *
 * The rules, in the order they are checked:
 *
 * 1. **No space yet** → anchor one at the viewport.
 * 2. **Stretched past `maxStretch`** → re-anchor. A 1.5× stretch is the point
 *    where rounded corners, minimum widths and the text start to look wrong.
 *    With `levels`, during a gesture, the re-anchor keeps the origin and
 *    steps the scale by a power of two, so the tiles of the two scales nest
 *    — and the renderer shows the old scale's tiles where the new scale's
 *    are not drawn yet, refilling a `budget` of tiles per frame. Without it,
 *    or when a step cannot do, the space is anchored at the viewport.
 *
 *    A step goes to the coarsest power of two that is **not coarser than
 *    the screen** (a stretch in (½, 1]), and so a space drawn into during a
 *    gesture is squeezed down to half before it steps out, not to two
 *    thirds. What is drawn during a gesture is drawn at that scale and then
 *    shown stretched; drawn at a coarser one, an item has less room in the
 *    space than on the screen, and a label that fits on the screen does not
 *    fit in the tile — until P17 a zoom out lost, for its last frames, every
 *    label that fitted its item tightly, and they came back at rest.
 * 3. **Shifted past `maxShift` pixels** → re-anchor, keeping the scale. Item
 *    coordinates grow with the distance travelled, and the browser stores SVG
 *    geometry in single precision: at 10⁵ px a float still resolves 1/128 px,
 *    much further out it starts to shimmer.
 * 4. **Settling** (no gesture running) **with any stretch at all** → anchor
 *    exactly, so a frame at rest is pixel-exact. A pure pan has no stretch,
 *    so settling after it keeps the space — and with it every node as is.
 *    With `levels`, a view whose scale is a power of two off the space's —
 *    a zoom back to where it started — settles on that level, around the
 *    same origin, where its tiles are still drawn.
 * 5. Otherwise the space is kept, and only its **extent** — what is drawn —
 *    changes: it always covers the viewport, is trimmed to the viewport plus
 *    the overscan, and **at rest** grows toward that by `growth` viewports
 *    per frame, on one side — the one with more still to draw, the later one
 *    on a tie — from the frame after the one that settles.
 *
 * A re-anchored space draws the viewport only — a stepped one keeps what is
 * drawn, as the old scale stands in for it. A re-anchor is the one frame
 * that rewrites everything drawn, so it should draw as little as possible;
 * the overscan comes afterwards, a strip per frame, while nothing moves —
 * one tile's worth, so that a frame at rest costs no more than a frame of a
 * pan does, and a gesture that starts during it waits for no frame. A
 * gesture never grows the extent — it only reaches as far as the viewport
 * does — because a frame spent drawing ahead is a frame the gesture misses.
 *
 * A space that needs nothing is returned unchanged — the same object. A host
 * draws a frame, plans again, and requests another frame if the plan
 * changed: that is how the overscan fills in at rest, and how a host knows
 * when it is done.
 */

import type { TimeInput } from "./types.js";
import { toTimeMs } from "./time.js";

/**
 * A stable coordinate space for the frame.
 *
 * Without one, everything is drawn where it is on screen, so every pan and
 * every zoom step rewrites the geometry of every visible item and label — at
 * 2000 items that is not the script's cost but the browser's, which
 * recomputes 2000 SVG shapes per frame, and with a thousand labels it
 * re-lays out every line of text (P7: 50 ms per frame at a 4x CPU slowdown,
 * with 3 ms of it script). With one, the frame is drawn at
 * `(time - origin) / msPerPx`, for the whole extent, and a single `transform`
 * per layer maps that space onto the viewport. A frame inside the extent
 * then rewrites nothing; one that reaches past it draws only what came in.
 *
 * The price is that while the space's scale differs from the viewport's, the
 * frame is *stretched*: corners, minimum widths and text are those of the
 * space, not of the viewport. {@link planSceneSpace} bounds the stretch and
 * re-anchors when a gesture ends, so a frame at rest is exact.
 */
export interface SceneSpace {
  /** The instant at main coordinate 0. */
  readonly origin: number;
  /** Milliseconds per pixel of the space. Positive and finite. */
  readonly msPerPx: number;
  /**
   * The time range drawn. It has to cover the viewport; the renderer rounds
   * it out to whole tiles. Without one, exactly the viewport is drawn.
   */
  readonly extent?: readonly [number, number];
  /**
   * No gesture is running. Labels of items the viewport edge cuts off are
   * then pinned to the item's visible part, as in an exact frame; during a
   * gesture they stay where the extent puts them, because a label that moves
   * every frame is the text change the browser cannot do cheaply.
   */
  readonly atRest?: boolean;
  /**
   * How many tiles — or groups of tiles one tile of another scale covers — a
   * frame draws anew where tiles drawn at another scale of the same origin
   * can stand in, nested by a power of two. Without it everything is drawn.
   * The rest of what is in view is drawn in later frames:
   * {@link RenderResult.pendingTiles} says how many tiles in view are still
   * stood in for, and a host requests another frame while that is above
   * zero. Off-screen ones wait. A frame at rest gets no budget, so it is
   * exact.
   */
  readonly budget?: number;
  /**
   * Add no labels during the gesture: new tiles are drawn without theirs,
   * and the labels of items the near edge cuts off are not pinned to what
   * is on screen. For a host that would rather spend nothing on labels
   * while the view moves; at rest the space is exact again and the frame
   * shows every label an exact frame does. Kept through the gesture by
   * {@link planSceneSpace}, which no longer sets it itself: from P14 to
   * 1.0.0-rc.4 a stepped re-anchor did, because the browser lays SVG text
   * out again whenever its scale changes, and the labels of what was drawn
   * anew blinked out until the gesture ended. A label is a line of HTML
   * since rc.5, which the browser does not lay out again.
   */
  readonly bare?: boolean;
  /**
   * During a gesture, the scale the view rested at before it, in
   * milliseconds per pixel. {@link planSceneSpace} keeps it from the first
   * frame of the gesture to its end. A tile the gesture draws at a finer
   * scale fits its labels to the room its items had there: what had a label
   * keeps one, and what did not gets none until the gesture comes to rest —
   * a zoom in does not bring in, step by step, the hundreds of labels that
   * fit only once it is in.
   */
  readonly rest?: number;
}

/** The viewport a space is planned for. */
export interface SceneSpaceView {
  readonly domain: readonly [TimeInput, TimeInput];
  /** Main extent of the container, in CSS pixels. */
  readonly mainSize: number;
}

/** How a space is planned. */
export interface SceneSpacePlanOptions {
  /**
   * No gesture is running. A stretched space is re-anchored exactly, so the
   * frame at rest is the exact frame, and the extent grows into the overscan.
   */
  readonly settle?: boolean;
  /**
   * Largest stretch tolerated in either direction. 1.5 by default. With
   * `levels`, during a gesture, a space is squeezed down to half before it
   * steps out, whatever this says: a level is a power of two, and the step
   * goes to one not coarser than the screen.
   */
  readonly maxStretch?: number;
  /** Largest offset, in pixels, between the space and the viewport. 10⁵ by default. */
  readonly maxShift?: number;
  /** How far past each viewport edge to draw at rest, in viewports. 1 by default. */
  readonly overscan?: number;
  /**
   * How much of the overscan one frame at rest adds, in viewports, on one
   * side. 0.0625 by default: one tile of the renderer's, about as much as a
   * pan brings in per frame.
   */
  readonly growth?: number;
  /**
   * Re-anchor a gesture in steps of a power of two around the same origin,
   * so the renderer can stand the old scale in while the new one is drawn,
   * {@link SceneSpace.budget} tiles a frame. Off by default.
   *
   * A re-anchor otherwise rewrites everything in view in one frame: at 2000
   * items in view and a 4x CPU slowdown, ~50 ms, three missed frames, two or
   * three times in a 2x pinch.
   */
  readonly levels?: boolean;
  /**
   * Tiles a stepped frame draws anew. 2 by default — an eighth of a
   * viewport, as one tile was before tiles were a sixteenth. Only with
   * `levels`.
   */
  readonly budget?: number;
}

export const DEFAULT_MAX_STRETCH = 1.5;
export const DEFAULT_MAX_SHIFT = 100_000;
export const DEFAULT_OVERSCAN = 1;
export const DEFAULT_GROWTH = 0.0625;
export const DEFAULT_BUDGET = 2;

/** How far a space stepping in levels is squeezed before it steps out: to a half, one level. */
const LEVEL_SQUEEZE = 0.5;

/**
 * Below this, a stretch is no stretch: the transform prints nine decimals,
 * and a pan's floating-point noise in `msPerPx` is far under them.
 */
const SAME_SCALE = 1e-9;

/** The space the next frame should be drawn in. */
export function planSceneSpace(
  current: SceneSpace | undefined,
  view: SceneSpaceView,
  options: SceneSpacePlanOptions = {},
): SceneSpace {
  const start = toTimeMs(view.domain[0]);
  const end = toTimeMs(view.domain[1]);
  const maxStretch = options.maxStretch ?? DEFAULT_MAX_STRETCH;
  const maxShift = options.maxShift ?? DEFAULT_MAX_SHIFT;
  const overscan = options.overscan ?? DEFAULT_OVERSCAN;
  const growth = options.growth ?? DEFAULT_GROWTH;
  const atRest = options.settle === true;
  if (
    !(maxStretch >= 1) ||
    !(maxShift > 0) ||
    !(overscan >= 0 && Number.isFinite(overscan)) ||
    !(growth > 0 && Number.isFinite(growth))
  ) {
    throw new RangeError(
      "maxStretch must be at least 1, maxShift and growth positive, and overscan finite and not negative",
    );
  }
  if (!(view.mainSize > 0) || !(end > start)) {
    // Nothing is drawn into a container without pixels or a domain without
    // length (the renderer returns an empty frame), so there is nothing to
    // re-anchor for: keep what there is, or anchor something harmless.
    return current ?? { origin: start, msPerPx: 1, extent: [start, end], atRest };
  }
  const msPerPx = (end - start) / view.mainSize;
  // A stepped space draws a budget a frame; one at rest draws everything.
  const stepping = options.levels === true && !atRest;
  const budget = options.budget ?? DEFAULT_BUDGET;
  if (stepping && !(Number.isInteger(budget) && budget >= 1)) {
    throw new RangeError("budget must be a whole number of tiles, at least 1");
  }
  const paced = stepping ? { budget } : {};
  // The scale the view rested at: kept through a gesture, gone at rest.
  const rest = atRest || current === undefined ? undefined : current.atRest === true ? current.msPerPx : current.rest;
  const from = rest === undefined ? {} : { rest };
  if (current === undefined) {
    return { origin: start, msPerPx, extent: [start, end], atRest, ...paced };
  }
  const span = end - start;
  const pad = span * overscan;
  let scale = current.msPerPx;
  // A host that asked for bare frames gets them until the gesture comes to rest.
  const bare = !atRest && current.bare === true;
  const stretch = current.msPerPx / msPerPx;
  // Stepping in levels squeezes to a half: the next level out is then the
  // screen's own scale at most, never coarser.
  const squeeze = stepping ? Math.min(1 / maxStretch, LEVEL_SQUEEZE) : 1 / maxStretch;
  // Squeezed to exactly half, the next level out is the screen's own scale:
  // a zoom back to where it started lands there, on the tiles drawn there.
  if (stretch > maxStretch || stretch < squeeze || (stepping && stretch === squeeze)) {
    // A power of two around the same origin: the coarsest not coarser than
    // the viewport's scale, so what the step draws has the room it shows.
    const stepped = current.msPerPx / 2 ** Math.ceil(Math.log2(stretch));
    const left = stepped / msPerPx;
    if (
      !stepping ||
      left > maxStretch ||
      left < squeeze ||
      Math.abs(current.origin - start) / stepped > maxShift
    ) {
      return { origin: start, msPerPx, extent: [start, end], atRest, ...paced, ...from };
    }
    scale = stepped;
  } else if (Math.abs(current.origin - start) / msPerPx > maxShift) {
    // Keep the scale: nothing is stretched, the coordinates just got long.
    return { origin: start, msPerPx: current.msPerPx, extent: [start, end], atRest, ...paced, ...from };
  }
  if (atRest && Math.abs(stretch - 1) > SAME_SCALE) {
    // At rest on the scale of a level the space stepped through — a zoom
    // that came back to where it started — settle on that level, around the
    // same origin: its tiles are still drawn, and the frame is as exact as
    // one anchored at the viewport. Otherwise anchor there.
    const level = current.msPerPx * 2 ** Math.round(Math.log2(msPerPx / current.msPerPx));
    if (options.levels === true && Math.abs(level / msPerPx - 1) <= SAME_SCALE && Math.abs(current.origin - start) / level <= maxShift) {
      return { origin: current.origin, msPerPx: level, extent: [start, end], atRest };
    }
    return { origin: start, msPerPx, extent: [start, end], atRest };
  }

  const drawn = current.extent ?? [start, end];
  // What is drawn and still within the overscan stays; the viewport is
  // always added. A jump past everything drawn draws the viewport only —
  // the gap between would be the overscan of a viewport nobody looks at.
  const keptLow = Math.max(drawn[0], start - pad);
  const keptHigh = Math.min(drawn[1], end + pad);
  const touches = keptLow <= end && keptHigh >= start;
  let low = touches ? Math.min(keptLow, start) : start;
  let high = touches ? Math.max(keptHigh, end) : end;
  // Growth starts the frame after the one that settles: that frame is the
  // one the user waits for, and it draws only what the viewport needs.
  if (atRest && current.atRest === true) {
    // One side a frame: two strips of new items in one frame at rest were
    // the frame a wheel run, ending, missed (P15).
    const step = span * growth;
    if (end + pad - high >= low - (start - pad)) {
      high = Math.min(high + step, end + pad);
    } else {
      low = Math.max(low - step, start - pad);
    }
  }
  if (
    scale === current.msPerPx &&
    low === drawn[0] &&
    high === drawn[1] &&
    (current.atRest === true) === atRest &&
    current.budget === paced.budget &&
    (current.bare === true) === bare &&
    current.rest === rest &&
    current.extent !== undefined
  ) {
    return current;
  }
  // Same origin, same scale: everything still inside keeps its coordinates
  // to the bit, and only what came in is new. A stepped scale keeps the
  // origin too, so what was drawn stands in until it is drawn again.
  return { origin: current.origin, msPerPx: scale, extent: [low, high], atRest, ...paced, ...from, ...(bare ? { bare } : {}) };
}
