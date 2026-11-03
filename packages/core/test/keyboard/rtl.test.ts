/**
 * G-KEYBOARD, right to left: the binding hands every key resolver the other
 * arrow, so each arrow does what the arrow pointing the same way on screen
 * does left to right — the timeline's own keys, the tools' axis keys, the
 * range's and the group tree's. Every capability a gesture has keeps its key.
 */

import { expect, it } from "vitest";

import { MIRRORED_KEYS } from "../../src/dom/attach.js";
import { resolveGroupKey } from "../../src/groups/index.js";
import { DEFAULT_KEY_BINDINGS, resolveKey } from "../../src/keyboard.js";
import { resolveAxisKey } from "../../src/tools/keys.js";
import { resolveRangeKey } from "../../src/tools/range.js";
import type { Orientation } from "../../src/types.js";
import { describeBothOrientations } from "../orientation.js";

const ARROWS = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"] as const;
const MODIFIERS = [
  {},
  { shiftKey: true },
  { altKey: true },
  { shiftKey: true, altKey: true },
] as const;

function sample(key: string, extra: Partial<{ shiftKey: boolean; altKey: boolean }> = {}) {
  return { key, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, time: 0, ...extra };
}

/** The key a mirrored frame hands on: what `attachInput` does with `direction: "rtl"`. */
const mirrored = (key: string): string => MIRRORED_KEYS[key] ?? key;

describeBothOrientations("keys right to left", (orientation: Orientation) => {
  const horizontal = orientation === "horizontal";

  it("[claim:rtl-keys] moves the way the arrow points on screen: left is later horizontally, the next lane vertically", () => {
    const left = (extra: Partial<{ shiftKey: boolean; altKey: boolean }> = {}) => resolveKey(sample(mirrored("ArrowLeft"), extra), orientation);
    const right = (extra: Partial<{ shiftKey: boolean; altKey: boolean }> = {}) => resolveKey(sample(mirrored("ArrowRight"), extra), orientation);
    // Time flows from the right horizontally; vertically the lanes start at the right.
    expect(left()).toBe(horizontal ? "next" : "rowNext");
    expect(right()).toBe(horizontal ? "previous" : "rowPrevious");
    expect(left({ altKey: true })).toBe(horizontal ? "moveLater" : "laneNext");
    expect(right({ altKey: true })).toBe(horizontal ? "moveEarlier" : "lanePrevious");
    expect(left({ shiftKey: true })).toBe(horizontal ? "endLater" : undefined);
    expect(left({ shiftKey: true, altKey: true })).toBe(horizontal ? "startLater" : undefined);
    // Up and down are not mirrored.
    expect(resolveKey(sample(mirrored("ArrowDown")), orientation)).toBe(resolveKey(sample("ArrowDown"), orientation));
    // Every arrow binding of the defaults is still reached by some arrow.
    const reached = new Set<string | undefined>();
    for (const key of ARROWS) for (const extra of MODIFIERS) reached.add(resolveKey(sample(mirrored(key), extra), orientation));
    for (const binding of DEFAULT_KEY_BINDINGS) {
      if (binding.key.startsWith("main") || binding.key.startsWith("cross")) expect(reached.has(binding.action), binding.action).toBe(true);
    }
  });

  it("[claim:rtl-keys] mirrors the tools' axis keys, the range's and the group tree's", () => {
    const later = horizontal ? "ArrowLeft" : "ArrowDown";
    const earlier = horizontal ? "ArrowRight" : "ArrowUp";
    expect(resolveAxisKey(sample(mirrored(later)), orientation)).toBe("later");
    expect(resolveAxisKey(sample(mirrored(earlier)), orientation)).toBe("earlier");
    expect(resolveRangeKey(sample(mirrored(later)), orientation, { picking: true })).toBe(resolveRangeKey(sample(horizontal ? "ArrowRight" : "ArrowDown"), orientation, { picking: true }));
    // The tree's left and right are expand and collapse as the reading direction has them.
    for (const key of ["ArrowLeft", "ArrowRight"]) {
      expect(resolveGroupKey(sample(mirrored(key)), orientation)).toEqual(resolveGroupKey(sample(key === "ArrowLeft" ? "ArrowRight" : "ArrowLeft"), orientation));
    }
    // Keys that are not arrows pass as they are.
    for (const key of ["Home", "End", "PageUp", "Enter", "n", "["]) expect(mirrored(key)).toBe(key);
  });
});
