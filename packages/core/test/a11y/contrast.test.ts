import { describe, expect, it } from "vitest";

import { THEMES } from "../../src/theme.js";
import type { ThemeTokenName } from "../../src/theme.js";

/**
 * The built-in themes meet WCAG 2.2 AA contrast, token by token.
 *
 * `axe` cannot check this for us: it does not compute the contrast of SVG
 * text or shapes, so a theme could fail AA in every frame while the axe check
 * run stays green. The pairs below are the ones the stylesheet actually puts
 * on top of each other (`theme.ts`), with the threshold the criterion sets:
 * 4.5:1 for text (1.4.3), 3:1 for the graphics a user has to see to operate
 * the timeline — an item's outline, the selection, the focus ring, the
 * markers (1.4.11).
 */

type Pair = readonly [foreground: ThemeTokenName, background: ThemeTokenName, minimum: number, why: string];

const PAIRS: readonly Pair[] = [
  ["text", "surface", 4.5, "major tick labels, labels after an item"],
  ["text", "surfaceAlt", 4.5, "labels after an item, over a band"],
  ["textMuted", "surface", 4.5, "minor tick labels"],
  ["textMuted", "surfaceAlt", 4.5, "minor tick labels over the axis band"],
  ["itemText", "itemFill", 4.5, "labels inside an item"],
  ["eraText", "era", 4.5, "era labels"],
  ["now", "surface", 4.5, "the now marker's label"],
  ["marker", "surface", 4.5, "marker labels"],
  ["itemStroke", "surface", 3, "an item's outline: where it starts and ends"],
  ["itemStroke", "surfaceAlt", 3, "an item's outline over a band"],
  ["focus", "surface", 3, "the selection outline and the focus ring"],
  ["focus", "surfaceAlt", 3, "the focus ring over a band"],
  ["focus", "itemFill", 3, "the focus ring next to a neighbouring item"],
  ["lineStrong", "surface", 3, "major ticks"],
  ["now", "surfaceAlt", 3, "the now line across a band"],
  ["accent", "surface", 3, "the loading mark on the axis"],
  ["accent", "surfaceAlt", 3, "the loading mark over a band"],
  ["surface", "accent", 4.5, "a cluster's count on its marker"],
];

function luminance(hex: string): number {
  const value = Number.parseInt(hex.slice(1), 16);
  const channel = (shift: number): number => {
    const c = ((value >> shift) & 0xff) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0);
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

describe("theme contrast", () => {
  it("computes contrast as WCAG defines it", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
  });

  for (const theme of THEMES) {
    for (const [foreground, background, minimum, why] of PAIRS) {
      it(`${theme.name}: ${foreground} on ${background} is at least ${String(minimum)}:1 (${why})`, () => {
        const ratio = contrast(theme.tokens[foreground], theme.tokens[background]);
        expect(ratio, `${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(minimum);
      });
    }
  }
});
