/**
 * Pages: a layout cut across its lanes, so a long timeline prints.
 *
 * Every page shows the whole range along the time axis, at the paper's
 * width, and the lanes are cut between rows. The break is always a place no
 * item spans — so every item lands on exactly one page and none is cut in
 * two. Two exceptions, both where there is no such place within a page: an
 * item taller than a page, which the break goes through and nothing else if
 * it can; and rows of items that overlap, each shorter than a page, together
 * taller than one. Then the cut is at the page's edge, and an item it goes
 * through is drawn on the page it starts on, to that edge.
 *
 * Time is not cut. A cut along the time axis would split every item across
 * the break between two pages, and "on exactly one page" would stop being
 * true of any long item.
 */

import type { Layout, LayoutItem } from "../layout.js";
import type { TimeMs } from "../types.js";

/** One page's band of the layout, in its cross coordinates: `[from, to)`. */
export interface PageBand {
  readonly from: number;
  readonly to: number;
}

/**
 * The bands of a layout, each at most `capacity` across.
 *
 * A page ends at the last place in its capacity that no item spans — where a
 * lane or an item starts, or the layout ends. Nothing else: a row's top is
 * where its items start.
 */
export function paginate(layout: Layout, capacity: number): PageBand[] {
  if (!(capacity > 0) || !Number.isFinite(capacity)) {
    throw new RangeError(`A page needs a positive, finite capacity, got ${String(capacity)}`);
  }
  const end = layout.crossSize;
  const starts = new Set<number>([end]);
  for (const lane of layout.lanes) starts.add(lane.cross);
  for (const placed of layout.items) starts.add(placed.cross);
  const candidates = [...starts].filter((at) => at > 0 && at <= end).sort((a, b) => a - b);
  // What a break at `at` goes through: every item, or only the ones taller than a page.
  const cuts = (at: number, tall: boolean): boolean =>
    layout.items.some((placed) => placed.cross < at && placed.cross + placed.crossSize > at && (!tall || placed.crossSize <= capacity));
  const bands: PageBand[] = [];
  let from = 0;
  while (from < end) {
    let to: number | undefined;
    let past: number | undefined;
    for (const at of candidates) {
      if (at > from + capacity) break;
      if (at <= from) continue;
      if (!cuts(at, false)) to = at;
      // Beside an item taller than a page, the break goes through it and nothing else.
      else if (!cuts(at, true)) past = at;
    }
    // No place spares every item that fits: cut at the page's edge.
    to ??= past ?? Math.min(from + capacity, end);
    bands.push({ from, to });
    from = to;
  }
  return bands.length === 0 ? [{ from: 0, to: 0 }] : bands;
}

/** Whether an item is on a band's page: it starts there. */
export function onBand(placed: LayoutItem, band: PageBand): boolean {
  return placed.cross >= band.from && placed.cross < band.to;
}

/**
 * The layout one page draws: every lane, and only the band's items.
 *
 * The renderer draws a row past each edge of its frame, so a stroke or a
 * corner never pops in late on screen. On paper that row is the next page's
 * first: without this, it would print twice.
 */
export function bandLayout<T>(layout: Layout<T>, band: PageBand): Layout<T> {
  return { ...layout, items: layout.items.filter((placed) => onBand(placed, band)) };
}

/**
 * The time a layout's items cover, with a margin either side: what "the whole
 * range" prints. `undefined` for a layout with no item of finite extent.
 */
export function contentRange(layout: Layout, margin = 0.02): readonly [TimeMs, TimeMs] | undefined {
  let start = Infinity;
  let end = -Infinity;
  for (const placed of layout.items) {
    // An open interval has no end of its own to print to, and an instant's
    // span is the one millisecond `resolveSpan` gives it: their start counts.
    const { start: from, end: to, open } = placed.span;
    start = Math.min(start, from);
    end = Math.max(end, open || to - from <= 1 ? from : to);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return undefined;
  // An instant, or items at one moment: an hour either side.
  const pad = Math.max((end - start) * margin, end === start ? 3_600_000 : 0);
  return [start - pad, end + pad];
}
