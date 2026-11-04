/**
 * Live data: adding, changing and removing items without reloading them.
 *
 * A feed, a collaborator's edit, a status that changes — a timeline with
 * live data gets a handful of changes at a time, and laying out ten thousand
 * items again for each is what makes it stutter. Packing is per lane, so a
 * change only ever moves the items of the lanes it touches; every other lane
 * keeps its sublanes and only slides across if a lane before it grew or
 * shrank. {@link relayout} does exactly that, and promises the layout a full
 * `layoutItems` would give — the claim the live-data tests check against a full
 * reload, frame for frame.
 */

import { DEFAULT_LANE_ID, derivedLanes, firstFit, laneOrder, layoutItems, placeInSublane, resolveSpan, sublaneSpanOf, withDefaultLane } from "../layout.js";
import type { ItemSpan, Layout, LayoutItem, LayoutLane, LayoutOptions } from "../layout.js";
import type { Item, Lane, PackMode } from "../types.js";

/** A change to one item: its id, and the fields that change. `undefined` takes a field away. */
export type ItemUpdate<T = unknown> = { readonly id: string } & { readonly [K in Exclude<keyof Item<T>, "id">]?: Item<T>[K] | undefined };

/** A batch of changes: added, changed, removed — applied in that order. */
export interface ItemChanges<T = unknown> {
  readonly add?: readonly Item<T>[];
  readonly update?: readonly ItemUpdate<T>[];
  readonly remove?: readonly string[];
}

/** What a batch did. */
export interface AppliedChanges<T = unknown> {
  /** The new items: the old ones in their order, the changed ones in place, the added ones at the end. */
  readonly items: readonly Item<T>[];
  readonly added: readonly Item<T>[];
  readonly updated: readonly Item<T>[];
  readonly removed: readonly Item<T>[];
  /** Every lane id a change touched: an added item's, a removed one's, a changed one's before and after. */
  readonly lanes: ReadonlySet<string>;
}

/**
 * Apply a batch to an items array, which is not changed.
 *
 * An add with an id already there, or an update of one that is not, is a
 * host bug and throws: a live feed that silently forks an item is worse than
 * one that stops. Removing an id that is not there is not an error — two
 * feeds may remove the same item.
 */
export function applyItemChanges<T>(items: readonly Item<T>[], changes: ItemChanges<T>): AppliedChanges<T> {
  const index = new Map<string, number>();
  items.forEach((item, at) => index.set(item.id, at));
  const next: (Item<T> | undefined)[] = [...items];
  const lanes = new Set<string>();
  const added: Item<T>[] = [];
  const updated: Item<T>[] = [];
  const removed: Item<T>[] = [];
  for (const item of changes.add ?? []) {
    if (index.has(item.id)) throw new RangeError(`Cannot add item "${item.id}": an item with that id is already there`);
    index.set(item.id, next.length);
    next.push(item);
    added.push(item);
    lanes.add(item.laneId ?? DEFAULT_LANE_ID);
  }
  for (const update of changes.update ?? []) {
    const at = index.get(update.id);
    const before = at === undefined ? undefined : next[at];
    if (at === undefined || before === undefined) throw new RangeError(`Cannot update item "${update.id}": there is no item with that id`);
    const after = { ...before } as Record<string, unknown>;
    for (const [key, value] of Object.entries(update)) {
      // An own `__proto__` (JSON.parse makes one) is not a field: assigned, it would set the item's prototype.
      if (key === "__proto__") continue;
      if (value === undefined) delete after[key];
      else after[key] = value;
    }
    const item = after as unknown as Item<T>;
    next[at] = item;
    updated.push(item);
    lanes.add(before.laneId ?? DEFAULT_LANE_ID);
    lanes.add(item.laneId ?? DEFAULT_LANE_ID);
  }
  const gone = new Set<number>();
  for (const id of changes.remove ?? []) {
    const at = index.get(id);
    const item = at === undefined ? undefined : next[at];
    if (at === undefined || item === undefined || gone.has(at)) continue;
    gone.add(at);
    removed.push(item);
    lanes.add(item.laneId ?? DEFAULT_LANE_ID);
  }
  const kept = gone.size === 0 ? (next as Item<T>[]) : next.filter((item, at) => item !== undefined && !gone.has(at)) as Item<T>[];
  return { items: kept, added, updated, removed, lanes };
}

function sameLane(a: Lane, b: Lane): boolean {
  return a === b || (a.id === b.id && a.label === b.label && a.pinned === b.pinned && a.packMode === b.packMode && a.minCrossSize === b.minCrossSize);
}

/**
 * The layout of `items` after a batch, from the layout before it.
 *
 * `previous` must be the layout of the items before the batch with these
 * same options, and `touched` the batch's lanes ({@link AppliedChanges}).
 * The lanes no change touched keep their placements and move across by
 * whatever the lanes before them grew; the touched ones are packed again.
 * When the lanes themselves change — a derived lane appears or empties, the
 * host's list is another — it lays out from scratch: the result is always
 * `layoutItems(items, options)`, only cheaper.
 */
export function relayout<T>(previous: Layout<T>, items: readonly Item<T>[], touched: ReadonlySet<string>, options: LayoutOptions = {}): Layout<T> {
  const lanes = withDefaultLane(laneOrder(options.lanes ?? derivedLanes(items)), items);
  if (lanes.length !== previous.lanes.length || lanes.some((lane, at) => !sameLane(lane, (previous.lanes[at] as LayoutLane).lane))) {
    return layoutItems(items, options);
  }
  const laneIds = new Set(lanes.map((lane) => lane.id));
  if (laneIds.size !== lanes.length) return layoutItems(items, options);
  const metrics = { rowSize: 24, rowGap: 2, laneGap: 8, ...options.metrics };
  const timeZone = options.timeZone;
  const fallbackMode: PackMode = options.packMode ?? "pack";
  // An item naming no declared lane is drawn in the default lane.
  const laneOf = (item: Item<T>): string => {
    const id = item.laneId ?? DEFAULT_LANE_ID;
    return laneIds.has(id) ? id : DEFAULT_LANE_ID;
  };
  const isTouched = (id: string): boolean => touched.has(id) || (id === DEFAULT_LANE_ID && [...touched].some((each) => !laneIds.has(each)));
  const repack = new Set(lanes.filter((lane) => isTouched(lane.id)).map((lane) => lane.id));

  // The touched lanes' items, start-sorted, ties in input order — as layoutItems takes them.
  const fresh = new Map<string, { item: Item<T>; index: number; span: ItemSpan }[]>();
  items.forEach((item, index) => {
    const lane = laneOf(item);
    if (!repack.has(lane)) return;
    const entry = { item, index, span: timeZone === undefined ? resolveSpan(item) : resolveSpan(item, timeZone) };
    const bucket = fresh.get(lane);
    if (bucket === undefined) fresh.set(lane, [entry]);
    else bucket.push(entry);
  });
  for (const bucket of fresh.values()) bucket.sort((a, b) => a.span.start - b.span.start || a.index - b.index);

  // The untouched lanes' placements, in the order they were placed.
  const kept = new Map<string, LayoutItem<T>[]>();
  for (const placed of previous.items) {
    if (repack.has(placed.laneId)) continue;
    const bucket = kept.get(placed.laneId);
    if (bucket === undefined) kept.set(placed.laneId, [placed]);
    else bucket.push(placed);
  }

  const outLanes: LayoutLane[] = [];
  const outItems: LayoutItem<T>[] = [];
  let rowOffset = 0;
  let cross = 0;
  lanes.forEach((lane, at) => {
    const before = previous.lanes[at] as LayoutLane;
    let sublaneCount: number;
    let crossSize: number;
    if (!repack.has(lane.id)) {
      sublaneCount = before.sublaneCount;
      crossSize = before.crossSize;
      const rowShift = rowOffset - before.rowOffset;
      const crossShift = cross - before.cross;
      for (const placed of kept.get(lane.id) ?? []) {
        outItems.push(rowShift === 0 && crossShift === 0 ? placed : { ...placed, row: placed.row + rowShift, cross: placed.cross + crossShift });
      }
    } else {
      // layoutItems' own packing, for this lane.
      const mode: PackMode = lane.packMode ?? fallbackMode;
      const occupied: ItemSpan[][] = [];
      const placements: { entry: { item: Item<T>; span: ItemSpan }; base: number; height: number }[] = [];
      let nextSingle = 0;
      for (const entry of fresh.get(lane.id) ?? []) {
        const height = sublaneSpanOf(entry.item);
        const base = mode === "overlap" ? 0 : mode === "single" ? nextSingle : firstFit(occupied, entry.span, height);
        if (mode === "single") nextSingle += height;
        if (mode === "pack") placeInSublane(occupied, base, entry.span, height);
        placements.push({ entry, base, height });
      }
      const used = placements.reduce((max, p) => Math.max(max, p.base + p.height), 0);
      sublaneCount = Math.max(used, 1);
      crossSize = Math.max(sublaneCount * metrics.rowSize + (sublaneCount - 1) * metrics.rowGap, lane.minCrossSize ?? 0);
      for (const { entry, base, height } of placements) {
        outItems.push({
          item: entry.item,
          laneId: lane.id,
          sublane: base,
          row: rowOffset + base,
          sublaneSpan: height,
          span: entry.span,
          cross: cross + base * (metrics.rowSize + metrics.rowGap),
          crossSize: height * metrics.rowSize + (height - 1) * metrics.rowGap,
        });
      }
    }
    const same = before.rowOffset === rowOffset && before.cross === cross && before.sublaneCount === sublaneCount && before.crossSize === crossSize && before.lane === lane;
    outLanes.push(same ? before : { lane, sublaneCount, rowOffset, cross, crossSize, pinned: lane.pinned === true });
    rowOffset += sublaneCount;
    cross += crossSize + metrics.laneGap;
  });
  return { lanes: outLanes, items: outItems, rowCount: rowOffset, crossSize: Math.max(cross - metrics.laneGap, 0) };
}
