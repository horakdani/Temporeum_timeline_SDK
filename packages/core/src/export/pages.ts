/**
 * Paper, and the frames a timeline prints as.
 *
 * Lengths on paper are points (1/72 in), as PDF and CSS `@page` both take
 * them; a frame is drawn in CSS pixels, 96 to the inch, so a point is 4/3 of
 * a pixel and a page drawn at its printable size in pixels lands on paper at
 * exactly 100%.
 */

import { densityMetrics } from "../density.js";
import { renderTimeline } from "../render.js";
import type { RenderOptions, RenderResult } from "../render.js";
import type { TimeMs } from "../types.js";
import { bandLayout, contentRange, paginate } from "./paginate.js";
import type { PageBand } from "./paginate.js";

/** Sheet sizes, in points, portrait. */
export const PAPER_SIZES = {
  a3: [842, 1191],
  a4: [595, 842],
  a5: [420, 595],
  letter: [612, 792],
  legal: [612, 1008],
} as const;

/** How a page is set. */
export interface PaperOptions {
  /** A named sheet, or `[width, height]` in points. `a4` by default. */
  readonly size?: keyof typeof PAPER_SIZES | readonly [number, number];
  /** `landscape` by default: a timeline is wider than it is tall. */
  readonly orientation?: "portrait" | "landscape";
  /** The margin on every side, in points. 36 (half an inch) by default. */
  readonly margin?: number;
}

/** A sheet, resolved: its size and margin in points, its printable box in CSS pixels. */
export interface Paper {
  readonly width: number;
  readonly height: number;
  readonly margin: number;
  readonly contentWidth: number;
  readonly contentHeight: number;
}

/** CSS pixels to a point. */
export const PX_TO_PT = 0.75;

/** A sheet from its options. */
export function resolvePaper(options: PaperOptions = {}): Paper {
  const size = options.size ?? "a4";
  const [short, long] = typeof size === "string" ? PAPER_SIZES[size] : [Math.min(...size), Math.max(...size)];
  const [width, height] = (options.orientation ?? "landscape") === "landscape" ? [long, short] : [short, long];
  const margin = options.margin ?? 36;
  const contentWidth = Math.floor((width - 2 * margin) / PX_TO_PT);
  const contentHeight = Math.floor((height - 2 * margin) / PX_TO_PT);
  if (!(contentWidth > 0 && contentHeight > 0)) {
    throw new RangeError(`The margin leaves no room on a ${String(width)} x ${String(height)} pt sheet`);
  }
  return { width, height, margin, contentWidth, contentHeight };
}

/** One printed page: its frame, and the band of the layout it holds. */
export interface PrintedPage<T = unknown> {
  readonly frame: RenderResult<T>;
  readonly band: PageBand;
}

/** What a print takes beyond the frame's own options. */
export interface PrintOptions extends PaperOptions {
  /** The time printed: `"all"` (the default) for the items' whole range, or two instants. */
  readonly range?: "all" | readonly [TimeMs, TimeMs];
}

/**
 * The frames a timeline prints as: the whole range across each page, the
 * lanes cut between rows, every item on exactly one page.
 *
 * `options` is the frame as on screen; its domain is what prints when there
 * is nothing to take the range from. Its size is the paper's, an `auto`
 * theme prints light, its selection,
 * focus and loading marks are not printed, and the frames are images: no
 * focus stop, no listbox.
 */
export function printPages<T>(options: RenderOptions<T>, print: PrintOptions = {}): PrintedPage<T>[] {
  const paper = resolvePaper(print);
  const orientation = options.orientation ?? "horizontal";
  const metrics = (options.metrics ?? densityMetrics)(options.density ?? "comfortable", orientation);
  const across = orientation === "horizontal" ? paper.contentHeight : paper.contentWidth;
  const sized = (cross: number): { width: number; height: number } =>
    orientation === "horizontal" ? { width: paper.contentWidth, height: cross } : { width: cross, height: paper.contentHeight };
  const base: RenderOptions<T> = {
    ...options,
    ...sized(across),
    // Paper is light: "auto" would follow the screen's scheme onto it.
    theme: options.theme === undefined || options.theme === "auto" ? "light" : options.theme,
    interactive: false,
    selectedIds: [],
    focusedId: null,
    loading: [],
    crossOffset: 0,
  };
  // The renderer's own layout, from a frame of the page's size.
  const layout = options.layout ?? renderTimeline(base).layout;
  const range = print.range === undefined || print.range === "all" ? (contentRange(layout) ?? options.domain) : print.range;
  return paginate(layout, Math.max(across - metrics.axisSize, 1)).map((band) => ({
    band,
    frame: renderTimeline({
      ...base,
      ...sized(metrics.axisSize + band.to - band.from),
      domain: range,
      layout: bandLayout(layout, band),
      crossOffset: band.from,
    }),
  }));
}
