/**
 * HTML text as SVG text.
 *
 * Item labels are a line of HTML in a `foreignObject` (P17). A browser draws
 * that on screen and in a standalone SVG; it does not let a canvas that drew
 * one be read back (the canvas is "tainted"), so a PNG cannot hold it, and a
 * PDF has no HTML at all. Flattened, each becomes the same text in a
 * `<text>` — the label's classes, so the stylesheet colours and sizes it
 * the same, past the same padding, centred across — inside a nested `<svg>`
 * of the box, which clips it there as the `foreignObject` did. Rich HTML (an
 * item template) keeps its text and loses its markup.
 */

import type { SceneElement } from "../scene.js";
import { computeStyle, sheetOf } from "./style.js";
import type { StyleSheet } from "./style.js";

function textOf(node: SceneElement): string {
  return (node.text ?? "") + (node.children ?? []).map(textOf).join("");
}

function flattenNode(node: SceneElement, sheet: StyleSheet): SceneElement {
  if (node.tag !== "foreignObject") {
    return node.children === undefined ? node : { ...node, children: node.children.map((child) => flattenNode(child, sheet)) };
  }
  const { x, y, width, height, class: className, ...rest } = node.attrs ?? {};
  const inner = node.children?.[0];
  const style = inner === undefined ? {} : computeStyle(inner, {}, sheet);
  const sides = (style.padding ?? "").split(/\s+/).filter((part) => part !== "");
  const pad = Number.parseFloat(style["padding-left"] ?? sides[sides.length === 4 ? 3 : sides.length > 1 ? 1 : 0] ?? "0") || 0;
  return {
    tag: "svg",
    attrs: { ...rest, x, y, width, height },
    children: [
      {
        tag: "text",
        attrs: { class: className, x: pad, y: Number(height ?? 0) / 2, "dominant-baseline": "central" },
        text: textOf(node).replace(/\s+/g, " ").trim(),
      },
    ],
  };
}

/** A scene with every `foreignObject` as clipped SVG text. */
export function flattenHtmlText(scene: SceneElement): SceneElement {
  return flattenNode(scene, sheetOf(scene));
}
