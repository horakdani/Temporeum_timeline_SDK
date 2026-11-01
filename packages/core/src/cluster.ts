/**
 * Clustering: what a dense zoom draws instead of a smear.
 *
 * When fifty events shrink to three pixels each, a timeline either paints
 * them on top of each other or leaves them out. Neither says what is there.
 * A cluster does: one marker over the run of items, with their count on it,
 * that a tap or `Enter` zooms into until the items come apart.
 *
 * Four decisions shape the file, and the gate (G-CLUSTER) holds each of them:
 *
 * 1. **A cluster lives in one row.** Items are clustered along the time axis
 *    inside a sublane, never across rows. The layout already guarantees that
 *    nothing else is packed between two neighbours in a row, so a marker that
 *    covers its members' stretch of the row covers nothing that is not one of
 *    them. A rectangle across rows would sit on whatever the other rows hold
 *    between the members. Rows come from the layout, so this is `(main,
 *    cross)` space and the vertical orientation is the same code.
 * 2. **Membership is decided in time, from the zoom level alone.** Two items
 *    join when the gap between them, *as drawn*, is under {@link
 *    ClusterOptions.gap} pixels — a question about milliseconds per pixel,
 *    never about where the viewport is. A pan therefore never splits a
 *    cluster or swallows a new item into it, and a marker's count does not
 *    tick while the user drags.
 * 3. **Only what is too small to read is clustered.** An item drawn at
 *    least {@link ClusterOptions.itemSize} pixels long stays itself and ends
 *    the run, and so does an open interval or one taller than a row. A
 *    marker never hides a bar someone could have read.
 * 4. **A cluster is all of its members.** The count is the cluster's size,
 *    not the part of it on screen, and the renderer draws a cluster exactly
 *    when it would have drawn any of its members. Nothing on screen is lost,
 *    and nothing is counted twice.
 *
 * Pure, like the rest of the core: a layout and a zoom level in, plain
 * objects out.
 */

import type { Layout, LayoutItem } from "./layout.js";
import type { TimeScale } from "./scale.js";
import type { MainCrossRect, TimeMs } from "./types.js";

/** Pixels between two drawn items below which they are one cluster. */
export const DEFAULT_CLUSTER_GAP = 4;

/**
 * Drawn length, in pixels, from which an item is never clustered.
 *
 * The coarse pointer's hit slop: below it a finger cannot tell an item from
 * its neighbour anyway, above it the item is a target in its own right.
 */
export const DEFAULT_CLUSTER_ITEM_SIZE = 12;

/** Fewest members a cluster has. Two: one item is just an item. */
export const DEFAULT_CLUSTER_MIN_COUNT = 2;

/** How eagerly items are clustered. */
export interface ClusterOptions {
  /** Pixels between two drawn items below which they join. {@link DEFAULT_CLUSTER_GAP}. */
  readonly gap?: number;
  /** Drawn length from which an item stays itself. {@link DEFAULT_CLUSTER_ITEM_SIZE}. */
  readonly itemSize?: number;
  /** Fewest members a cluster has; shorter runs are drawn as items. At least 2. */
  readonly minCount?: number;
}

/** Everything {@link clusterLayout} needs beyond the layout and the zoom. */
export interface ClusterLayoutOptions extends ClusterOptions {
  /**
   * Shortest main extent an item is drawn with. The renderer's
   * `minItemMainSize`: a gap is measured between items *as drawn*, and an
   * instant is drawn wider than it is.
   */
  readonly minItemMainSize?: number;
}

/** A run of items in one row, drawn as one marker. */
export interface Cluster<T = unknown> {
  /**
   * The id of its first member. A clustered member is not an entry of its
   * own anywhere — not in the frame, not in the keyboard's walk — so the
   * id cannot meet another entry's; and once a zoom dissolves the cluster,
   * a focus on it lands on that first member by itself.
   */
  readonly id: string;
  /** In time order. Never fewer than `minCount`. */
  readonly members: readonly LayoutItem<T>[];
  /** Start of the first member. */
  readonly start: TimeMs;
  /** Latest end among the members, as laid out. */
  readonly end: TimeMs;
  /** Start of the last member: with `start`, the range the members begin in. */
  readonly lastStart: TimeMs;
  /**
   * The free stretch of the row around the run, in time: halfway to the
   * neighbours on either side, unbounded where there is none. A marker too
   * narrow for its count grows into it — never further, so two markers, or a
   * marker and an item, never meet.
   */
  readonly room: readonly [start: TimeMs, end: TimeMs];
  readonly laneId: string;
  readonly row: number;
  /** Position across, in the layout's own space — the row's. */
  readonly cross: number;
  readonly crossSize: number;
}

/** The clusters of one layout at one zoom level. */
export interface Clustering<T = unknown> {
  readonly layout: Layout<T>;
  readonly msPerPx: number;
  readonly gap: number;
  readonly itemSize: number;
  readonly minCount: number;
  readonly minItemMainSize: number;
  /** Every cluster, in layout order of their first members. */
  readonly clusters: readonly Cluster<T>[];
  /** The cluster an item is drawn in, or `undefined` when it is drawn as itself. */
  clusterOf(itemId: string): Cluster<T> | undefined;
  /** A cluster by its own id. */
  byId(clusterId: string): Cluster<T> | undefined;
}

/** Rows of a layout, each in time order, with every item in every row it covers. */
const rowCache = new WeakMap<Layout<unknown>, readonly (readonly LayoutItem<unknown>[])[]>();

function rowsOf<T>(layout: Layout<T>): readonly (readonly LayoutItem<T>[])[] {
  const known = rowCache.get(layout as Layout<unknown>);
  if (known !== undefined) {
    return known as readonly (readonly LayoutItem<T>[])[];
  }
  const rows = new Map<number, LayoutItem<T>[]>();
  for (const placed of layout.items) {
    // A tall item is in every row it covers: it is not a member anywhere,
    // but it has to end a run in each of them, or two small items on either
    // side of a narrow band would be clustered across it.
    for (let offset = 0; offset < placed.sublaneSpan; offset += 1) {
      const row = rows.get(placed.row + offset);
      if (row === undefined) {
        rows.set(placed.row + offset, [placed]);
      } else {
        row.push(placed);
      }
    }
  }
  // The layout already emits a lane's items in time order; sorting again is
  // for a layout a host built by hand. Stable, so ties keep layout order.
  const sorted = [...rows.values()].map((row) => row.sort((a, b) => a.span.start - b.span.start));
  rowCache.set(layout as Layout<unknown>, sorted);
  return sorted;
}

function positive(name: string, value: number, allowZero: boolean): number {
  if (!Number.isFinite(value) || value < 0 || (!allowZero && value === 0)) {
    throw new RangeError(`${name} must be a ${allowZero ? "non-negative" : "positive"} number, got ${String(value)}`);
  }
  return value;
}

/** The last clustering computed for each layout: a frame and its hit tester share it. */
const clusterCache = new WeakMap<Layout<unknown>, Clustering<unknown>>();

/**
 * The clusters of a layout at a zoom level.
 *
 * One pass over each row: a run grows while the next item starts less than
 * `gap` pixels after the run's drawn end, and ends at anything that may not
 * join. Runs of at least `minCount` become clusters. Memoised per layout and
 * settings, so the renderer, the hit tester and the keyboard's walk of one
 * frame get the same object.
 */
export function clusterLayout<T>(
  layout: Layout<T>,
  msPerPx: number,
  options: ClusterLayoutOptions = {},
): Clustering<T> {
  positive("msPerPx", msPerPx, false);
  const gap = positive("gap", options.gap ?? DEFAULT_CLUSTER_GAP, true);
  const itemSize = positive("itemSize", options.itemSize ?? DEFAULT_CLUSTER_ITEM_SIZE, false);
  const minItemMainSize = positive("minItemMainSize", options.minItemMainSize ?? 0, true);
  const minCount = options.minCount ?? DEFAULT_CLUSTER_MIN_COUNT;
  if (!Number.isInteger(minCount) || minCount < 2) {
    throw new RangeError(`minCount must be an integer of at least 2, got ${String(minCount)}`);
  }
  const known = clusterCache.get(layout as Layout<unknown>);
  if (
    known !== undefined &&
    known.msPerPx === msPerPx &&
    known.gap === gap &&
    known.itemSize === itemSize &&
    known.minCount === minCount &&
    known.minItemMainSize === minItemMainSize
  ) {
    return known as Clustering<T>;
  }

  const minMs = minItemMainSize * msPerPx;
  const gapMs = gap * msPerPx;
  const found: Cluster<T>[] = [];
  for (const row of rowsOf(layout)) {
    let run: LayoutItem<T>[] = [];
    let runEnd = Number.NEGATIVE_INFINITY;
    let runRoom = Number.NEGATIVE_INFINITY;
    // The furthest drawn end of everything met so far in the row.
    let lastEnd = Number.NEGATIVE_INFINITY;
    const flush = (nextStart: number): void => {
      if (run.length >= minCount) {
        found.push(clusterFrom(run, [runRoom, (runEnd + nextStart) / 2]));
      }
      run = [];
    };
    for (const placed of row) {
      const start = placed.span.start;
      const duration = placed.span.end - start;
      const drawnEnd = start + Math.max(duration, minMs);
      const joins =
        placed.sublaneSpan === 1 &&
        !placed.span.open &&
        Math.max(duration / msPerPx, minItemMainSize) < itemSize;
      if (!joins) {
        flush(start);
      } else if (run.length > 0 && start - runEnd < gapMs) {
        run.push(placed);
        runEnd = Math.max(runEnd, drawnEnd);
      } else {
        flush(start);
        run = [placed];
        runEnd = drawnEnd;
        runRoom = (lastEnd + start) / 2;
      }
      lastEnd = Math.max(lastEnd, drawnEnd);
    }
    flush(Number.POSITIVE_INFINITY);
  }

  // Layout order of the first members: the order the renderer meets them in.
  const order = new Map(layout.items.map((placed, index) => [placed, index]));
  found.sort((a, b) => (order.get(a.members[0] as LayoutItem<T>) ?? 0) - (order.get(b.members[0] as LayoutItem<T>) ?? 0));
  const byMember = new Map<string, Cluster<T>>();
  const byOwnId = new Map<string, Cluster<T>>();
  for (const cluster of found) {
    byOwnId.set(cluster.id, cluster);
    for (const member of cluster.members) {
      byMember.set(member.item.id, cluster);
    }
  }
  const clustering: Clustering<T> = {
    layout,
    msPerPx,
    gap,
    itemSize,
    minCount,
    minItemMainSize,
    clusters: found,
    clusterOf: (itemId) => byMember.get(itemId),
    byId: (clusterId) => byOwnId.get(clusterId),
  };
  clusterCache.set(layout as Layout<unknown>, clustering as Clustering<unknown>);
  return clustering;
}

function clusterFrom<T>(run: readonly LayoutItem<T>[], room: readonly [number, number]): Cluster<T> {
  const first = run[0] as LayoutItem<T>;
  const last = run[run.length - 1] as LayoutItem<T>;
  let end = first.span.end;
  for (const member of run) {
    end = Math.max(end, member.span.end);
  }
  return {
    id: first.item.id,
    members: run,
    start: first.span.start,
    end,
    lastStart: last.span.start,
    room,
    laneId: first.laneId,
    row: first.row,
    cross: first.cross,
    crossSize: first.crossSize,
  };
}

/**
 * The extent of a cluster as drawn, in a scale's pixels: from its first
 * member's start to the furthest drawn end among them. The union of the
 * members' boxes, which is exactly what the marker covers.
 */
export function clusterExtent<T>(
  cluster: Cluster<T>,
  scale: TimeScale,
  minItemMainSize = 0,
): { readonly main: number; readonly mainSize: number } {
  const main = scale.toMain(cluster.start);
  let end = main;
  for (const member of cluster.members) {
    const start = scale.toMain(member.span.start);
    end = Math.max(end, start + Math.max(scale.toMain(member.span.end) - start, minItemMainSize));
  }
  return { main, mainSize: end - main };
}

/**
 * The marker's extent along the main axis: the members' union, grown to
 * `minSize` when it is narrower — around its own middle, inside the
 * cluster's {@link Cluster.room}, so the count fits on it without reaching a
 * neighbour. Where the room is short, the marker takes all of it.
 */
export function clusterBox<T>(
  cluster: Cluster<T>,
  scale: TimeScale,
  minItemMainSize: number,
  minSize: number,
): { readonly main: number; readonly mainSize: number } {
  const union = clusterExtent(cluster, scale, minItemMainSize);
  if (union.mainSize >= minSize) {
    return union;
  }
  const end = union.main + union.mainSize;
  const from = Math.min(scale.toMain(cluster.room[0]), union.main);
  const to = Math.max(scale.toMain(cluster.room[1]), end);
  const size = Math.min(minSize, to - from);
  const main = Math.min(Math.max((union.main + end) / 2 - size / 2, from), to - size);
  return { main, mainSize: size };
}

/** A cluster as one frame drew it. */
export interface ClusterMarker<T = unknown> {
  readonly cluster: Cluster<T>;
  /**
   * The marker as drawn, container-relative and in the viewport's pixels —
   * after the lane scroll, and after a scene space's transform. What a
   * pointer is tested against.
   */
  readonly box: MainCrossRect;
}

/** How {@link clusterZoom} zooms. */
export interface ClusterZoomOptions {
  /**
   * The point to zoom at, in pixels along the main axis — the tap. Without
   * one, the middle of the part of the cluster in view: the keyboard's
   * focus, as for every keyboard zoom.
   *
   * A marker is drawn wider than its members' time — every instant gets its
   * minimum width, and a narrow marker grows to fit its count — so a finger
   * can land on it past the last member. The instant held under the finger
   * is then the member instant nearest to it, a few pixels at most, still
   * under the finger: anchoring on time where no member is would push all
   * of them out of view.
   */
  readonly anchor?: number;
  /** Share of the viewport the cluster's time should fill afterwards. 0.5 by default. */
  readonly fill?: number;
  /** Smallest zoom step, so a long cluster still opens. 2 by default. */
  readonly minFactor?: number;
}

/**
 * The zoom that opens a cluster: a factor for the input machine's `zoom`,
 * and where to anchor it.
 *
 * Anchored at the gesture, never at the viewport's centre (decision 8 of the
 * plan): the cluster grows out from under the finger. The factor makes its
 * time fill `fill` of the view, which pulls its members apart — and where
 * there are too many for that, into smaller clusters, the next tap's
 * target. A cluster already wider than that still gets `minFactor`.
 */
export function clusterZoom<T>(
  cluster: Cluster<T>,
  scale: TimeScale,
  options: ClusterZoomOptions = {},
): { readonly factor: number; readonly anchor: number } {
  const fill = options.fill ?? 0.5;
  if (!(fill > 0 && fill <= 1)) {
    throw new RangeError(`fill must be in (0, 1], got ${String(fill)}`);
  }
  const minFactor = positive("minFactor", options.minFactor ?? 2, false);
  const [from, to] = scale.domain;
  const width = (cluster.end - cluster.start) / scale.msPerPx;
  const factor = Math.max(minFactor, (fill * scale.mainSize) / width);
  if (options.anchor !== undefined) {
    const held = Math.min(Math.max(scale.toTime(options.anchor), cluster.start), cluster.end);
    return { factor, anchor: held === scale.toTime(options.anchor) ? options.anchor : scale.toMain(held) };
  }
  const start = Math.max(cluster.start, from);
  const end = Math.min(cluster.end, to);
  const middle = end > start ? (start + end) / 2 : (cluster.start + cluster.end) / 2;
  return { factor, anchor: Math.min(Math.max(scale.toMain(middle), 0), scale.mainSize) };
}
