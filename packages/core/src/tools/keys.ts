/**
 * The keys the time tools share: a step along the time axis, a page, the
 * ends. Axis-relative, like the machine's own — in a vertical timeline time
 * runs down, so `ArrowDown` is later.
 */

import type { KeySample } from "../keyboard.js";
import type { Orientation } from "../types.js";

/** A step along the time axis. */
export type AxisKeyAction = "earlier" | "later" | "pageEarlier" | "pageLater" | "first" | "last";

/** The axis step a key asks for, or `undefined`. Modifier keys belong to others. */
export function resolveAxisKey(sample: KeySample, orientation: Orientation): AxisKeyAction | undefined {
  if (sample.ctrlKey || sample.metaKey || sample.altKey) return undefined;
  const later = orientation === "vertical" ? "ArrowDown" : "ArrowRight";
  const earlier = orientation === "vertical" ? "ArrowUp" : "ArrowLeft";
  switch (sample.key) {
    case later:
      return "later";
    case earlier:
      return "earlier";
    case "PageDown":
      return "pageLater";
    case "PageUp":
      return "pageEarlier";
    case "Home":
      return "first";
    case "End":
      return "last";
    default:
      return undefined;
  }
}

/** Steps in a page. */
export const PAGE_STEPS = 10;

/** Steps an action moves by, signed; `undefined` for the ends. */
export function stepsOf(action: AxisKeyAction): number | undefined {
  return action === "later" ? 1 : action === "earlier" ? -1 : action === "pageLater" ? PAGE_STEPS : action === "pageEarlier" ? -PAGE_STEPS : undefined;
}

