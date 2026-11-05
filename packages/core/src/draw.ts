/**
 * The four SVG primitives, projected.
 *
 * Internal on purpose: it is the only place that turns `(main, cross)` boxes
 * into `x`/`y` attributes, so every drawn shape goes through one projection
 * and the vertical orientation cannot drift out of sync with the horizontal
 * one. A shape built by hand somewhere else would be a shape that works in
 * one orientation.
 */

import type { Projector } from "./geometry.js";
import type { SceneElement } from "./scene.js";
import type { MainCross, MainCrossRect } from "./types.js";

/**
 * `base` and the host's own classes. A `tl-` class is the timeline's: given
 * in data (`tl-item--selected`, `tl-groups`) it would draw a node as selected
 * or have it taken for a control, so it is left out. `tl-background` is the
 * one a decoration may carry: the items plugin draws a background item as an
 * era with it.
 */
export function withClass(base: string, extra: string | undefined): string {
  return extra === undefined ? base : [base, ...extra.split(/\s+/).filter((name) => name !== "" && !/^tl(-(?!background$)|$)/i.test(name))].join(" ");
}

/** `x`/`y`/`width`/`height` for a box, in the given orientation. */
export function rectAttrs(
  rect: MainCrossRect,
  projector: Projector,
): { x: number; y: number; width: number; height: number } {
  const screen = projector.projectRect(rect);
  return { x: screen.x, y: screen.y, width: screen.width, height: screen.height };
}

/** `x1`/`y1`/`x2`/`y2` for a segment between two `(main, cross)` points. */
export function lineAttrs(
  from: MainCross,
  to: MainCross,
  projector: Projector,
): { x1: number; y1: number; x2: number; y2: number } {
  const a = projector.projectPoint(from);
  const b = projector.projectPoint(to);
  return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
}

/** A `points` list for a polygon given in `(main, cross)`. */
export function polygonPoints(
  points: readonly MainCross[],
  projector: Projector,
): string {
  return points
    .map((point) => {
      const screen = projector.projectPoint(point);
      const round = (value: number): string => String(Math.round(value * 1000) / 1000);
      return `${round(screen.x)},${round(screen.y)}`;
    })
    .join(" ");
}

/**
 * A line of text inside a box.
 *
 * The text is left-aligned with the box's leading edge and centred across it,
 * and it never rotates: a vertical timeline with sideways labels is a timeline
 * nobody reads. That is why the box's cross extent is the *text's* extent here
 * and the projection only moves it.
 */
export function textNode(
  box: MainCrossRect,
  text: string,
  projector: Projector,
  className: string,
  padding: number,
): SceneElement {
  const screen = projector.projectRect(box);
  return {
    tag: "text",
    attrs: {
      class: className,
      x: screen.x + padding,
      y: screen.y + screen.height / 2,
      "dominant-baseline": "central",
      "text-anchor": "start",
    },
    text,
  };
}

/** The namespace of what a `foreignObject` holds. */
export const XHTML_NS = "http://www.w3.org/1999/xhtml";

/** The attributes of every line of HTML text: one object, so a patch compares one reference. */
const HTML_LINE_ATTRS = Object.freeze({ xmlns: XHTML_NS });

/**
 * A line of text inside a box, as HTML in a `foreignObject`.
 *
 * Laid out like {@link textNode} — leading edge, centred across, never
 * rotated — but the browser lays HTML text out in its own box, whatever
 * scale the drawing above it is shown at. An SVG `<text>` is laid out
 * again whenever that scale changes (Blink sizes its glyphs for the screen),
 * and during a zoom a drawing in a scene space changes scale on every step:
 * in Chromium at a 4x slowdown, two thousand labels as `<text>` made every
 * frame that changed the scale 33 ms; the same labels as HTML left the
 * frame at 16.7 ms.
 *
 * The box's cross extent is one line, and the stylesheet gives the HTML
 * its padding and line height, so the attributes of the inner node are the
 * same object for every label.
 */
export function htmlTextNode(
  box: MainCrossRect,
  text: string,
  projector: Projector,
  attrs: Readonly<Record<string, string | number | undefined>>,
): SceneElement {
  const screen = projector.projectRect(box);
  return {
    tag: "foreignObject",
    attrs: { ...attrs, x: screen.x, y: screen.y, width: screen.width, height: screen.height },
    children: [{ tag: "div", attrs: HTML_LINE_ATTRS, text }],
  };
}
