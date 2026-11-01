/**
 * Layout: items into collision-free sublanes.
 *
 * This is the part a timeline library is actually judged on, so three
 * decisions are worth stating before the code.
 *
 * **Collision is in time, not in pixels.** Two items share a sublane when
 * their spans do not overlap, whatever the zoom. That makes the layout
 * independent of the viewport and therefore cacheable across zooms and
 * orientations — the alternative, deciding overlap from rendered width, forces
 * a full relayout on every wheel tick and makes rows jump while the user
 * zooms.
 *
 * **Lanes are row blocks.** A lane owns its band of sublanes and never shares
 * one with another lane. That is what "group by category" means on screen, and
 * it is why a host that wants the densest possible packing puts everything in
 * one lane instead of asking for a mode.
 *
 * **Nothing here produces pixels along the time axis.** A `LayoutItem` carries
 * a resolved span and a cross position; turning the span into a main-axis
 * extent is the scale's job, and {@link itemRect} is where the two meet. Cross
 * positions do not depend on time, so they belong here.
 */

import { addCalendar, DEFAULT_TIME_ZONE, startOf } from "./calendar.js";
import type { TimeScale } from "./scale.js";
import { toTimeMs } from "./time.js";
import type { Item, Lane, MainCrossRect, PackMode, TimeMs } from "./types.js";

/** A resolved time extent. `end` is `Infinity` for an open interval. */
export interface ItemSpan {
  readonly start: TimeMs;
  readonly end: TimeMs;
  /** True when the interval has no known end and reaches past any viewport. */
  readonly open: boolean;
}

/** How much room a sublane and a lane get across the lane axis, in CSS pixels. */
export interface LayoutMetrics {
  /** Cross extent of one sublane. */
  readonly rowSize?: number;
  /** Gap between sublanes inside a lane. */
  readonly rowGap?: number;
  /** Gap between lanes. */
  readonly laneGap?: number;
}

/** What the caller tunes. */
export interface LayoutOptions {
  /**
   * The lanes, in cross order. Pinned lanes are moved to the front. When
   * omitted, lanes are derived from the items' `laneId` in order of first
   * appearance, which is the order a host's own data already implies.
   */
  readonly lanes?: readonly Lane[];
  /** Packing for lanes that do not set their own. Defaults to `pack`. */
  readonly packMode?: PackMode;
  /** Zone used to resolve a granularity into an extent. Defaults to UTC. */
  readonly timeZone?: string;
  readonly metrics?: LayoutMetrics;
}

/** One placed item. */
export interface LayoutItem<T = unknown> {
  readonly item: Item<T>;
  readonly laneId: string;
  /** Index inside the lane, from zero. */
  readonly sublane: number;
  /** Index across the whole layout — the lane's offset plus the sublane. */
  readonly row: number;
  /** How many sublanes it occupies. */
  readonly sublaneSpan: number;
  readonly span: ItemSpan;
  /** Position across the lane axis, in CSS pixels. */
  readonly cross: number;
  readonly crossSize: number;
}

/** One laid-out lane. */
export interface LayoutLane {
  readonly lane: Lane;
  /** Sublanes the lane ended up needing. At least one, even when empty. */
  readonly sublaneCount: number;
  /** Row index of the lane's first sublane. */
  readonly rowOffset: number;
  readonly cross: number;
  readonly crossSize: number;
  readonly pinned: boolean;
}

/** The whole layout. Zoom-independent: safe to cache until the items change. */
export interface Layout<T = unknown> {
  readonly lanes: readonly LayoutLane[];
  readonly items: readonly LayoutItem<T>[];
  /** Total sublanes across every lane. */
  readonly rowCount: number;
  /** Cross extent the layout needs, in CSS pixels. */
  readonly crossSize: number;
}

const DEFAULT_METRICS = { rowSize: 24, rowGap: 2, laneGap: 8 } as const;

/** Lane id used for items that name none. */
export const DEFAULT_LANE_ID = "";

/**
 * The time an item covers.
 *
 * Granularity is what makes this more than reading two fields: an item known
 * to the day covers the whole day in the host's zone, so two same-day events
 * collide even though their timestamps differ. A true instant covers one
 * millisecond, which keeps two events at the same instant from being packed
 * into the same sublane.
 */
export function resolveSpan(item: Item, timeZone: string = DEFAULT_TIME_ZONE): ItemSpan {
  const rawStart = toTimeMs(item.start);
  const granularity = item.granularity;
  const snapped =
    granularity === undefined || granularity === "millisecond"
      ? rawStart
      : startOf(rawStart, granularity, timeZone);

  if (item.open === true) {
    return { start: snapped, end: Number.POSITIVE_INFINITY, open: true };
  }

  const unitEnd = (from: TimeMs): TimeMs =>
    granularity === undefined || granularity === "millisecond"
      ? from + 1
      : addCalendar(startOf(from, granularity, timeZone), granularity, 1, timeZone);

  if (item.end === undefined) {
    return { start: snapped, end: unitEnd(rawStart), open: false };
  }

  const rawEnd = toTimeMs(item.end);
  if (granularity === undefined || granularity === "millisecond") {
    // The given end is the end. The floor keeps a zero-length or inverted
    // interval — a host bug the layout survives rather than hides — from
    // becoming a span nothing can ever collide with.
    return { start: rawStart, end: Math.max(rawEnd, rawStart + 1), open: false };
  }
  // An interval known to the day runs to the end of its last day.
  return { start: snapped, end: Math.max(unitEnd(rawEnd), unitEnd(rawStart)), open: false };
}

function overlaps(a: ItemSpan, b: ItemSpan): boolean {
  return !(a.end <= b.start || a.start >= b.end);
}

export function laneOrder(lanes: readonly Lane[]): readonly Lane[] {
  // Pinned first, order preserved inside each group: a stable partition, so a
  // host that pins a lane sees it move to the edge and nothing else change.
  return [...lanes.filter((lane) => lane.pinned === true), ...lanes.filter((lane) => lane.pinned !== true)];
}

export function derivedLanes(items: readonly Item[]): readonly Lane[] {
  const seen = new Set<string>();
  const lanes: Lane[] = [];
  for (const item of items) {
    const id = item.laneId ?? DEFAULT_LANE_ID;
    if (!seen.has(id)) {
      seen.add(id);
      lanes.push({ id });
    }
  }
  return lanes;
}

export function sublaneSpanOf(item: Item): number {
  const span = item.sublaneSpan;
  if (span === undefined) {
    return 1;
  }
  if (!Number.isInteger(span) || span < 1) {
    throw new RangeError(`Item ${item.id}: sublaneSpan must be a positive integer, got ${String(span)}`);
  }
  return span;
}

/**
 * The lowest sublane where a span of `height` consecutive sublanes is free.
 *
 * First fit, which is what makes the result stable: adding an item never moves
 * the ones already placed, so the layout does not reshuffle while a user
 * drags.
 */
export function firstFit(occupied: ItemSpan[][], span: ItemSpan, height: number): number {
  for (let base = 0; ; base += 1) {
    let fits = true;
    for (let offset = 0; offset < height; offset += 1) {
      const sublane = occupied[base + offset];
      if (sublane !== undefined && sublane.some((other) => overlaps(span, other))) {
        fits = false;
        break;
      }
    }
    if (fits) {
      return base;
    }
  }
}

export function placeInSublane(occupied: ItemSpan[][], base: number, span: ItemSpan, height: number): void {
  for (let offset = 0; offset < height; offset += 1) {
    const index = base + offset;
    const sublane = occupied[index];
    if (sublane === undefined) {
      occupied[index] = [span];
    } else {
      sublane.push(span);
    }
  }
}

/**
 * Place items into lanes and collision-free sublanes.
 *
 * Items are taken in order of start time, ties in input order. That ordering
 * is load-bearing for `pack`: first fit over a start-sorted sequence is what
 * gives the minimal number of sublanes for a set of intervals, and it is also
 * what makes the result reproducible for a golden test.
 */
export function layoutItems<T = unknown>(
  items: readonly Item<T>[],
  options: LayoutOptions = {},
): Layout<T> {
  const timeZone = options.timeZone ?? DEFAULT_TIME_ZONE;
  const metrics = { ...DEFAULT_METRICS, ...options.metrics };
  if (metrics.rowSize <= 0 || !Number.isFinite(metrics.rowSize)) {
    throw new RangeError(`rowSize must be a positive number of pixels, got ${String(metrics.rowSize)}`);
  }
  const fallbackMode = options.packMode ?? "pack";
  const lanes = laneOrder(options.lanes ?? derivedLanes(items));
  const laneById = new Map(lanes.map((lane) => [lane.id, lane]));
  if (laneById.size !== lanes.length) {
    // Two lanes with one id would each claim the same items and place them
    // twice. Better a loud error than a layout with ghosts in it.
    throw new RangeError("Duplicate lane id in the lane list");
  }

  // Start-sorted once, globally: every lane then consumes its own items in the
  // same order, so the outcome does not depend on how the host grouped them.
  const prepared = items
    .map((item, index) => ({ item, index, span: resolveSpan(item, timeZone) }))
    .sort((a, b) => a.span.start - b.span.start || a.index - b.index);

  const byLane = new Map<string, typeof prepared>();
  for (const entry of prepared) {
    const id = entry.item.laneId ?? DEFAULT_LANE_ID;
    // An item naming a lane the host did not declare would otherwise vanish;
    // it goes to the default lane, which is visible rather than silent.
    const laneId = laneById.has(id) ? id : DEFAULT_LANE_ID;
    const bucket = byLane.get(laneId);
    if (bucket === undefined) {
      byLane.set(laneId, [entry]);
    } else {
      bucket.push(entry);
    }
  }

  const laidOutLanes: LayoutLane[] = [];
  const laidOutItems: LayoutItem<T>[] = [];
  let rowOffset = 0;
  let cross = 0;

  for (const lane of lanes) {
    const mode: PackMode = lane.packMode ?? fallbackMode;
    const entries = byLane.get(lane.id) ?? [];
    const occupied: ItemSpan[][] = [];
    const placements: { entry: (typeof entries)[number]; base: number; height: number }[] = [];
    let nextSingle = 0;

    for (const entry of entries) {
      const height = sublaneSpanOf(entry.item);
      const base =
        mode === "overlap"
          ? 0
          : mode === "single"
            ? nextSingle
            : firstFit(occupied, entry.span, height);
      if (mode === "single") {
        nextSingle += height;
      }
      if (mode === "pack") {
        placeInSublane(occupied, base, entry.span, height);
      }
      placements.push({ entry, base, height });
    }

    const used = placements.reduce((max, p) => Math.max(max, p.base + p.height), 0);
    const sublaneCount = Math.max(used, 1);
    const laneCrossSize = sublaneCount * metrics.rowSize + (sublaneCount - 1) * metrics.rowGap;
    const minCross = lane.minCrossSize ?? 0;
    const crossSize = Math.max(laneCrossSize, minCross);

    for (const { entry, base, height } of placements) {
      laidOutItems.push({
        item: entry.item as Item<T>,
        laneId: lane.id,
        sublane: base,
        row: rowOffset + base,
        sublaneSpan: height,
        span: entry.span,
        cross: cross + base * (metrics.rowSize + metrics.rowGap),
        crossSize: height * metrics.rowSize + (height - 1) * metrics.rowGap,
      });
    }

    laidOutLanes.push({
      lane,
      sublaneCount,
      rowOffset,
      cross,
      crossSize,
      pinned: lane.pinned === true,
    });
    rowOffset += sublaneCount;
    cross += crossSize + metrics.laneGap;
  }

  return {
    lanes: laidOutLanes,
    items: laidOutItems,
    rowCount: rowOffset,
    crossSize: Math.max(cross - metrics.laneGap, 0),
  };
}

/**
 * A placed item as a box in `(main, cross)` space.
 *
 * An open interval is clipped to the end of the scale's domain, because
 * `Infinity` is not a drawable width; the `open` flag on the span is how a
 * renderer knows to draw the edge as unfinished rather than as an end.
 */
export function itemRect(placed: LayoutItem, scale: TimeScale): MainCrossRect {
  const main = scale.toMain(placed.span.start);
  const end = placed.span.open ? scale.domain[1] : placed.span.end;
  return {
    main,
    mainSize: Math.max(scale.toMain(end) - main, 0),
    cross: placed.cross,
    crossSize: placed.crossSize,
  };
}

/**
 * Whether any two items share a sublane while overlapping in time.
 *
 * The invariant the whole file exists to hold, exported so that a host — and
 * the property-based test — can check it rather than trust it.
 */
export function findSublaneOverlap(
  layout: Layout,
): { readonly a: LayoutItem; readonly b: LayoutItem } | undefined {
  const byRow = new Map<number, LayoutItem[]>();
  for (const placed of layout.items) {
    for (let offset = 0; offset < placed.sublaneSpan; offset += 1) {
      const row = placed.row + offset;
      const bucket = byRow.get(row);
      if (bucket === undefined) {
        byRow.set(row, [placed]);
      } else {
        bucket.push(placed);
      }
    }
  }
  for (const bucket of byRow.values()) {
    for (let i = 0; i < bucket.length; i += 1) {
      for (let j = i + 1; j < bucket.length; j += 1) {
        const a = bucket[i];
        const b = bucket[j];
        if (a !== undefined && b !== undefined && overlaps(a.span, b.span)) {
          return { a, b };
        }
      }
    }
  }
  return undefined;
}
