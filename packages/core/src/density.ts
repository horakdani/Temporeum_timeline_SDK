/**
 * Density: the three sizes a timeline comes in, and the one thing about them
 * that is not obvious.
 *
 * `comfortable`, `compact` and `dense` are not a style preference. They are
 * the answer to "how much of this fits before it stops being readable", and
 * every number a renderer needs comes from here so that geometry and
 * typography cannot drift apart.
 *
 * **The metrics depend on the orientation, and that is the responsive core of
 * the whole library.** In a horizontal timeline a lane is a 22-pixel row and a
 * label runs along the time axis. In a vertical one a lane is a *column*, the
 * time axis runs down it, and the label still has to read horizontally —
 * across the lane. A column therefore has to be wide where a row is thin. A
 * library that keeps one set of numbers for both ends up with a vertical mode
 * that technically works and shows no text; this is the difference between
 * supporting an orientation and being usable in it.
 */

import type { Density, Orientation } from "./types.js";

/** A measure that differs between a row and a column. */
type PerOrientation = Readonly<Record<Orientation, number>>;

/** Every size one render needs, resolved. */
export interface DensityMetrics {
  readonly density: Density;
  readonly orientation: Orientation;
  /** Cross extent of one sublane: a row's height, or a column's width. */
  readonly rowSize: number;
  readonly rowGap: number;
  readonly laneGap: number;
  /** Item label type size, in pixels. */
  readonly fontSize: number;
  /** Axis and decoration type size, in pixels. */
  readonly tickFontSize: number;
  /** Cross extent one line of text needs, including leading. */
  readonly lineHeight: number;
  /** Space between a label and the edge of its box. */
  readonly labelPadding: number;
  /** Cross extent reserved for the axis, before the first lane. */
  readonly axisSize: number;
  /** Room one tick label is given along the time axis. */
  readonly tickSpacing: number;
  /** Smallest main extent an item is drawn with, so an instant stays visible. */
  readonly minItemMainSize: number;
  /**
   * Main extent a typical visible item needs for `density: "auto"` to grant
   * this level — the "pixels per unit of time" half of the decision.
   *
   * Lives here, next to the type sizes it is derived from, so that a font
   * change and the threshold that depends on it cannot drift apart.
   */
  readonly autoMainRoom: number;
  readonly cornerRadius: number;
  readonly fontFamily: string;
}

/**
 * The sizes a frame draws with, by level and orientation — `densityMetrics`
 * unless a host gives its own (`RenderOptions.metrics`). Called often: a
 * host's should return one object per level and orientation.
 */
export type MetricsProvider = (density: Density, orientation: Orientation) => DensityMetrics;

/** The three densities, coarsest first. The source of truth for the test matrix. */
export const DENSITIES: readonly Density[] = ["comfortable", "compact", "dense"];

const FONT_FAMILY = 'system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif';

interface DensityRow {
  readonly rowSize: PerOrientation;
  readonly rowGap: number;
  readonly laneGap: number;
  readonly fontSize: number;
  readonly tickFontSize: number;
  readonly lineHeight: number;
  readonly labelPadding: number;
  readonly axisSize: PerOrientation;
  readonly tickSpacing: PerOrientation;
  readonly minItemMainSize: number;
  readonly autoMainRoom: PerOrientation;
  readonly cornerRadius: number;
}

/**
 * The table.
 *
 * `autoMainRoom` is the one column that is not a size but a threshold. Along
 * a horizontal axis a label runs *along* the item, so the room is a label's
 * length: about eight characters of comfortable type with its padding (72),
 * three of compact (32). Along a vertical axis the label runs across and the
 * main extent holds *lines*: three comfortable lines with padding (60), one
 * compact line (24 — exactly `lineHeight + 2 * labelPadding`). `dense` draws
 * no label, so it needs no room at all.
 *
 * Every numeric column is non-increasing from `comfortable` to `dense`, and a
 * test holds that: a "denser" setting that made something bigger would be a
 * setting nobody could reason about.
 */
const TABLE: Readonly<Record<Density, DensityRow>> = {
  comfortable: {
    rowSize: { horizontal: 28, vertical: 168 },
    rowGap: 4,
    laneGap: 12,
    fontSize: 12,
    tickFontSize: 11,
    lineHeight: 16,
    labelPadding: 6,
    axisSize: { horizontal: 24, vertical: 84 },
    tickSpacing: { horizontal: 96, vertical: 56 },
    minItemMainSize: 3,
    autoMainRoom: { horizontal: 72, vertical: 60 },
    cornerRadius: 4,
  },
  compact: {
    rowSize: { horizontal: 22, vertical: 128 },
    rowGap: 3,
    laneGap: 9,
    fontSize: 11,
    tickFontSize: 10,
    lineHeight: 14,
    labelPadding: 5,
    axisSize: { horizontal: 20, vertical: 72 },
    tickSpacing: { horizontal: 80, vertical: 48 },
    minItemMainSize: 2,
    autoMainRoom: { horizontal: 32, vertical: 24 },
    cornerRadius: 3,
  },
  dense: {
    rowSize: { horizontal: 16, vertical: 88 },
    rowGap: 2,
    laneGap: 6,
    fontSize: 10,
    tickFontSize: 9,
    lineHeight: 12,
    labelPadding: 4,
    axisSize: { horizontal: 18, vertical: 64 },
    tickSpacing: { horizontal: 64, vertical: 40 },
    minItemMainSize: 2,
    autoMainRoom: { horizontal: 0, vertical: 0 },
    cornerRadius: 2,
  },
};

/** Resolved sizes for one density and orientation. */
export function densityMetrics(density: Density, orientation: Orientation): DensityMetrics {
  // Keyed by orientation rather than indexed: a tuple would need a fallback
  // for an index TypeScript cannot prove exists, and an unreachable fallback
  // is a branch no test can ever cover.
  const row = TABLE[density];
  return {
    density,
    orientation,
    rowSize: row.rowSize[orientation],
    rowGap: row.rowGap,
    laneGap: row.laneGap,
    fontSize: row.fontSize,
    tickFontSize: row.tickFontSize,
    lineHeight: row.lineHeight,
    labelPadding: row.labelPadding,
    axisSize: row.axisSize[orientation],
    tickSpacing: row.tickSpacing[orientation],
    minItemMainSize: row.minItemMainSize,
    autoMainRoom: row.autoMainRoom[orientation],
    cornerRadius: row.cornerRadius,
    fontFamily: FONT_FAMILY,
  };
}
