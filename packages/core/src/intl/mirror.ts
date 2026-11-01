/**
 * Right to left: the frame as its mirror image, its words still readable.
 *
 * A right-to-left reader expects the inline direction reversed — and in a
 * timeline that is one axis in either orientation. Horizontally, time is
 * the inline axis: it flows from the right. Vertically, the lanes are: the
 * first lane is the rightmost. Both are the same operation, the screen's
 * `x` mirrored, so right to left is one transform at the root of the frame
 * and not a second geometry: everything the core draws, in `(main, cross)`
 * as ever, lands in its mirrored place, a pan transform and a scene space
 * included.
 *
 * What must not be mirrored is text. Each `<text>` and each line of HTML is
 * turned back about its own box by the stylesheet (`transform-box:
 * fill-box`), so it sits where the mirror put it and reads the right way;
 * it is laid out right to left, its anchor swapped so its box stays the
 * same. A PDF has no stylesheet engine for that: {@link mirrorTextNodes}
 * turns each text back with an attribute instead.
 *
 * The input half — a pointer's `x`, the wheel's `deltaX`, the left and
 * right arrows — is the `direction` option of `attachInput` in `/dom`.
 */

import { densityMetrics } from "../density.js";
import type { SceneElement } from "../scene.js";
import type { Density } from "../types.js";

/** Which way the inline axis runs. */
export type Direction = "ltr" | "rtl";

/** The class of the group that mirrors a frame. */
export const MIRROR_CLASS = "tl-mirror";

/**
 * The stylesheet that turns text back in a mirrored frame. A label's line of
 * HTML gets its padding on both sides: in a mirrored frame its inner edge is
 * the right one.
 */
export function mirrorCss(density: Density = "comfortable"): string {
  const m = `.tl .${MIRROR_CLASS}`;
  const pad = densityMetrics(density, "horizontal").labelPadding;
  return (
    `${m} text{transform-box:fill-box;transform-origin:center;transform:scaleX(-1);direction:rtl}` +
    `${m} text:not([text-anchor]),${m} text[text-anchor="start"]{text-anchor:end}` +
    `${m} text[text-anchor="end"]{text-anchor:start}` +
    // A line of HTML takes its direction from its own text — a Latin label in a
    // right-to-left frame keeps its ellipsis at its end — and sits at the right.
    `${m} foreignObject>*{transform:scaleX(-1);direction:rtl;unicode-bidi:plaintext;text-align:right}` +
    `${m} .tl-label>div{padding:0 ${String(pad)}px}`
  );
}

/** How a frame is mirrored. */
export interface MirrorOptions {
  /** Embed {@link mirrorCss}. On by default; off for a host whose stylesheet has it. */
  readonly style?: boolean;
}

/**
 * A frame, right to left.
 *
 * The root's own `<style>` stays where it is; everything drawn moves into one
 * group mirrored across the frame's width, and the root says `dir="rtl"`. A
 * frame that is not an `<svg>` root, or has no width, is returned as it is.
 */
export function mirrorScene(scene: SceneElement, options: MirrorOptions = {}): SceneElement {
  const width = Number(scene.attrs?.width);
  if (scene.tag !== "svg" || !(width > 0)) return scene;
  const children = scene.children ?? [];
  const styles = children.filter((child) => child.tag === "style");
  const drawn = children.filter((child) => child.tag !== "style");
  const density = scene.attrs?.["data-tl-density"];
  return {
    ...scene,
    attrs: { ...scene.attrs, dir: "rtl", "data-tl-direction": "rtl" },
    children: [
      ...styles,
      ...(options.style === false ? [] : [{ tag: "style", text: mirrorCss(typeof density === "string" ? (density as Density) : undefined) }]),
      { tag: "g", attrs: { class: MIRROR_CLASS, transform: `matrix(-1 0 0 1 ${String(width)} 0)` }, children: drawn },
    ],
  };
}

const SWAPPED: Readonly<Record<string, string>> = { start: "end", end: "start" };

/**
 * A mirrored frame's text turned back by attributes, for a reader with no
 * stylesheet engine — the PDF writer. Each `<text>` is mirrored about its
 * own `x` with its anchor swapped: the same box, read the right way. Flatten
 * the HTML first (`flattenHtmlText` in `/export`): a `foreignObject` is left
 * as it is.
 */
export function mirrorTextNodes(scene: SceneElement): SceneElement {
  if (scene.tag === "text") {
    const x = Number(scene.attrs?.x ?? 0);
    const anchor = String(scene.attrs?.["text-anchor"] ?? "start");
    const own = scene.attrs?.transform;
    // About `x` in the text's own coordinates: after a transform it already had.
    const back = `matrix(-1 0 0 1 ${String(2 * x)} 0)`;
    return {
      ...scene,
      attrs: { ...scene.attrs, "text-anchor": SWAPPED[anchor] ?? anchor, transform: own === undefined ? back : `${String(own)} ${back}` },
    };
  }
  return scene.children === undefined ? scene : { ...scene, children: scene.children.map(mirrorTextNodes) };
}
