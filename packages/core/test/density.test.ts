import { describe, expect, it } from "vitest";

import { DENSITIES, densityMetrics } from "../src/density.js";
import type { DensityMetrics } from "../src/density.js";
import { ORIENTATIONS } from "../src/geometry.js";
import { estimateTextWidth } from "../src/labels.js";

const NUMERIC_FIELDS = [
  "rowSize",
  "rowGap",
  "laneGap",
  "fontSize",
  "tickFontSize",
  "lineHeight",
  "labelPadding",
  "axisSize",
  "tickSpacing",
  "minItemMainSize",
  "autoMainRoom",
  "cornerRadius",
] as const satisfies readonly (keyof DensityMetrics)[];

describe("density metrics", () => {
  it("lists the three densities coarsest first", () => {
    expect(DENSITIES).toEqual(["comfortable", "compact", "dense"]);
  });

  it.each(ORIENTATIONS)("never grows a measure as density tightens [%s]", (orientation) => {
    const rows = DENSITIES.map((density) => densityMetrics(density, orientation));
    for (const field of NUMERIC_FIELDS) {
      for (let i = 1; i < rows.length; i += 1) {
        const previous = rows[i - 1];
        const current = rows[i];
        expect(previous).toBeDefined();
        expect(current).toBeDefined();
        expect(
          current?.[field],
          `${field}: ${DENSITIES[i] ?? "?"} must not exceed ${DENSITIES[i - 1] ?? "?"}`,
        ).toBeLessThanOrEqual(previous?.[field] ?? 0);
      }
    }
  });

  it.each(ORIENTATIONS)("reports back what it resolved [%s]", (orientation) => {
    for (const density of DENSITIES) {
      const metrics = densityMetrics(density, orientation);
      expect(metrics.density).toBe(density);
      expect(metrics.orientation).toBe(orientation);
    }
  });

  it("makes a vertical lane a column: wide enough for a horizontal label", () => {
    for (const density of DENSITIES) {
      const horizontal = densityMetrics(density, "horizontal");
      const vertical = densityMetrics(density, "vertical");
      expect(vertical.rowSize).toBeGreaterThan(horizontal.rowSize);
      // The claim that makes the vertical orientation usable rather than
      // merely supported: a short label fits across the lane.
      const width = estimateTextWidth("2025-03-30", vertical.fontSize) + vertical.labelPadding * 2;
      expect(vertical.rowSize).toBeGreaterThanOrEqual(width);
      expect(horizontal.rowSize).toBeLessThan(width);
    }
  });

  it("reserves more room for the axis in a vertical timeline", () => {
    for (const density of DENSITIES) {
      expect(densityMetrics(density, "vertical").axisSize).toBeGreaterThan(
        densityMetrics(density, "horizontal").axisSize,
      );
    }
  });

  it("keeps a line of text inside a row", () => {
    for (const orientation of ORIENTATIONS) {
      for (const density of DENSITIES) {
        const metrics = densityMetrics(density, orientation);
        expect(metrics.lineHeight).toBeGreaterThanOrEqual(metrics.fontSize);
        expect(metrics.lineHeight).toBeLessThanOrEqual(metrics.rowSize);
      }
    }
  });
});

describe("the vertical axis band", () => {
  it("is wide enough for a full date in every density", () => {
    // A vertical timeline's date column is its spine; a band that cannot hold
    // "2025-03-24" is a band that shows bare day numbers and nothing else.
    for (const density of DENSITIES) {
      const metrics = densityMetrics(density, "vertical");
      const width =
        estimateTextWidth("2025-03-24", metrics.tickFontSize) + metrics.labelPadding * 2;
      expect(metrics.axisSize, density).toBeGreaterThanOrEqual(width);
    }
  });
});
