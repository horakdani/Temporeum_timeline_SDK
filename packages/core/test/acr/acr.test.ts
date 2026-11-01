/**
 * Tests the conformance report (site/conformance/wcag22.json) names where
 * no other suite says it: the words a timeline draws — item labels and
 * tick labels — are text, in both themes and every density, and none of
 * them is a picture of text (WCAG 1.4.5).
 */

import { describe, expect, it } from "vitest";

import { renderTimeline, renderToSvgString } from "../../src/index.js";
import type { Item } from "../../src/types.js";

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 2, 2);
const ITEMS: Item[] = [
  { id: "a", start: T0, end: T0 + 6 * DAY, laneId: "work", label: "Design review" },
  { id: "b", start: T0 + 8 * DAY, end: T0 + 15 * DAY, laneId: "ship", label: "Release" },
  { id: "c", start: T0 + 17 * DAY, laneId: "ship", label: "Launch" },
];
const LANES = [{ id: "work" }, { id: "ship" }];

describe("ACR: text is text", () => {
  for (const density of ["comfortable", "compact", "dense"] as const) {
    for (const theme of ["light", "dark"] as const) {
      it(`[claim:text-not-image] ${density}, ${theme}: every item label and tick label is drawn as text, and nothing as an image`, () => {
        const frame = renderTimeline({ items: ITEMS, lanes: LANES, domain: [T0 - DAY, T0 + 20 * DAY], width: 960, height: 240, density, theme });
        const svg = renderToSvgString(frame.scene);
        expect(svg).not.toMatch(/<image\b|<img\b|<canvas\b|data:image/);
        for (const word of ["Design review", "Release", "Launch"]) expect(svg).toContain(`>${word}<`);
        const ticks = [...svg.matchAll(/<text\b[^>]*>([^<]+)<\/text>/g)].map((match) => match[1]);
        expect(ticks.length).toBeGreaterThanOrEqual(3);
      });
    }
  }
});
