/**
 * The keyboard half of the input pipeline: which key means what, and the
 * order a keyboard walks the items in.
 *
 * Nothing here acts. A key is resolved to a {@link KeyAction} by a table, and
 * the input machine runs the action through the same programmatic twins a
 * gesture runs — `pan`, `zoom`, `moveItems`, `resizeItem`. That is the
 * accessibility promise made checkable: there is no second implementation of
 * a move for the keyboard to drift away from, only a second way in.
 *
 * Two decisions shape the file:
 *
 * 1. **Bindings are relative to the axes.** A key is bound to "the next
 *    instant along time" (`main+`), not to `ArrowRight`, and the orientation
 *    picks the arrow. A vertical timeline therefore walks time with the
 *    up and down arrows without a second table, which is the same rule the
 *    geometry follows (`(main, cross)` inside, screen axes only at the edge).
 * 2. **The walk is in reading order, built once per layout.** Every item is
 *    reachable by one key pressed repeatedly — the property a screen-reader
 *    user depends on — and the cross-axis arrows step to the nearest item in
 *    the neighbouring row, which is what a sighted keyboard user expects.
 */

import type { Clustering } from "./cluster.js";
import type { Layout } from "./layout.js";
import type { Orientation, TimeMs } from "./types.js";

/** One key press, as the host saw it. `time` comes from the event. */
export interface KeySample {
  /** `KeyboardEvent.key`: `"ArrowRight"`, `"+"`, `"g"`, `" "`… */
  readonly key: string;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly time: number;
}

/** Everything a key can ask for. */
export type KeyAction =
  | "next"
  | "previous"
  | "rowNext"
  | "rowPrevious"
  | "first"
  | "last"
  | "panLater"
  | "panEarlier"
  | "crossForward"
  | "crossBack"
  | "zoomIn"
  | "zoomOut"
  | "activate"
  | "dismiss"
  | "jump"
  | "moveLater"
  | "moveEarlier"
  | "laneNext"
  | "lanePrevious"
  | "endLater"
  | "endEarlier"
  | "startLater"
  | "startEarlier";

/**
 * A key bound to an action.
 *
 * `key` is a `KeyboardEvent.key` value, or one of the four axis-relative
 * arrows: `main+` is later in time, `main-` earlier, `cross+` the next row
 * across, `cross-` the previous one.
 */
export interface KeyBinding {
  readonly key: string;
  readonly shift?: boolean;
  readonly alt?: boolean;
  readonly action: KeyAction;
}

/**
 * The default bindings.
 *
 * Nothing is bound with `ctrl` or `meta`: those belong to the browser and the
 * operating system, and a widget that takes `ctrl+=` breaks page zoom for the
 * people who need it most. `Alt` means "move the item", `Shift` "move its
 * edge" — one modifier per kind of edit, and the arrow says where.
 */
export const DEFAULT_KEY_BINDINGS: readonly KeyBinding[] = [
  { key: "main+", action: "next" },
  { key: "main-", action: "previous" },
  { key: "cross+", action: "rowNext" },
  { key: "cross-", action: "rowPrevious" },
  { key: "Home", action: "first" },
  { key: "End", action: "last" },
  { key: "PageDown", action: "panLater" },
  { key: "PageUp", action: "panEarlier" },
  { key: "PageDown", shift: true, action: "crossForward" },
  { key: "PageUp", shift: true, action: "crossBack" },
  { key: "+", action: "zoomIn" },
  { key: "=", action: "zoomIn" },
  { key: "-", action: "zoomOut" },
  { key: "Enter", action: "activate" },
  { key: " ", action: "activate" },
  { key: "Escape", action: "dismiss" },
  { key: "g", action: "jump" },
  { key: "main+", alt: true, action: "moveLater" },
  { key: "main-", alt: true, action: "moveEarlier" },
  { key: "cross+", alt: true, action: "laneNext" },
  { key: "cross-", alt: true, action: "lanePrevious" },
  { key: "main+", shift: true, action: "endLater" },
  { key: "main-", shift: true, action: "endEarlier" },
  { key: "main+", shift: true, alt: true, action: "startLater" },
  { key: "main-", shift: true, alt: true, action: "startEarlier" },
];

const ARROWS: Readonly<Record<Orientation, Readonly<Record<string, string>>>> = {
  horizontal: { ArrowRight: "main+", ArrowLeft: "main-", ArrowDown: "cross+", ArrowUp: "cross-" },
  vertical: { ArrowDown: "main+", ArrowUp: "main-", ArrowRight: "cross+", ArrowLeft: "cross-" },
};

/**
 * The action a key press asks for, or `undefined` when it is not ours.
 *
 * A printable key ignores `shift`, because on most layouts `+` *is*
 * shift-and-something. A named key has to match its modifiers exactly, so
 * `Shift+ArrowRight` is never mistaken for `ArrowRight`.
 */
export function resolveKey(
  sample: KeySample,
  orientation: Orientation,
  bindings: readonly KeyBinding[] = DEFAULT_KEY_BINDINGS,
): KeyAction | undefined {
  if (sample.ctrlKey || sample.metaKey) {
    return undefined;
  }
  const key = ARROWS[orientation][sample.key] ?? sample.key;
  const printable = key.length === 1;
  for (const binding of bindings) {
    if (
      binding.key === key &&
      (binding.alt ?? false) === sample.altKey &&
      (printable || (binding.shift ?? false) === sample.shiftKey)
    ) {
      return binding.action;
    }
  }
  return undefined;
}

/** One item as the keyboard sees it. */
export interface NavEntry {
  readonly id: string;
  /** The extent as laid out, in time. */
  readonly start: TimeMs;
  readonly end: TimeMs;
  readonly laneId: string;
  /** The row across the whole layout. */
  readonly row: number;
  /** Position across, in the layout's own space (before the lane scroll). */
  readonly cross: number;
  readonly crossSize: number;
  /**
   * Set when the entry is a cluster: how many items it stands for. A
   * cluster is one stop for the keyboard, as it is one marker on screen, and
   * it is never edited — `Enter` opens it.
   */
  readonly count?: number;
}

/** How {@link createNavigator} walks a layout. */
export interface NavigatorOptions {
  /** Cross extent before the first lane — the axis band. */
  readonly crossInset?: number;
  /**
   * Walk this frame's clusters as one stop each, instead of their members.
   * `RenderResult.clustering` as it is: `undefined` when clustering is off.
   */
  readonly clustering?: Clustering<unknown> | undefined;
}

/** The order a keyboard walks a frame in. Built by {@link createNavigator}. */
export interface Navigator {
  /** Every item, in reading order: by start, then row. */
  readonly entries: readonly NavEntry[];
  /** Lane ids in layout order, for a move between lanes. */
  readonly lanes: readonly string[];
  /** Cross extent before the first lane — the axis band. */
  readonly crossInset: number;
  /**
   * Position of an item in {@link Navigator.entries}, or -1. A clustered
   * item is at its cluster's position: focus on it is focus on the cluster.
   */
  indexOf(id: string): number;
}

/**
 * Per layout (or clustering), one navigator per cross inset. The renderer
 * asks for one without an inset, for the listbox's positions, and a host for
 * its own: kept as one per layout, the two evicted each other, and every
 * frame sorted every item twice.
 */
const navigators = new WeakMap<object, Map<number, Navigator>>();

/**
 * The keyboard's view of a layout.
 *
 * Memoised per layout — or per clustering, which belongs to one layout at one
 * zoom: the renderer hands back the same layout object while the items are
 * unchanged, so a host that rebuilds this on every frame sorts ten thousand
 * items once, not sixty times a second.
 */
export function createNavigator<T>(layout: Layout<T>, options: NavigatorOptions = {}): Navigator {
  const crossInset = options.crossInset ?? 0;
  const clustering = options.clustering;
  if (clustering !== undefined && clustering.layout !== layout) {
    // A clustering of another layout names clusters this one does not have;
    // walking it would focus items that are not drawn.
    throw new RangeError("The clustering belongs to a different layout");
  }
  const memoKey: object = clustering ?? layout;
  let byInset = navigators.get(memoKey);
  const known = byInset?.get(crossInset);
  if (known !== undefined) {
    return known;
  }
  // The order does not depend on the inset: another inset's navigator has it.
  const sibling = byInset?.values().next().value;
  if (byInset !== undefined && sibling !== undefined) {
    const navigator: Navigator = { ...sibling, crossInset };
    byInset.set(crossInset, navigator);
    return navigator;
  }
  const entries: NavEntry[] = [];
  for (const placed of layout.items) {
    if (clustering?.clusterOf(placed.item.id) === undefined) {
      entries.push({
        id: placed.item.id,
        start: placed.span.start,
        end: placed.span.end,
        laneId: placed.laneId,
        row: placed.row,
        cross: placed.cross,
        crossSize: placed.crossSize,
      });
    }
  }
  for (const cluster of clustering?.clusters ?? []) {
    entries.push({
      id: cluster.id,
      start: cluster.start,
      end: cluster.end,
      laneId: cluster.laneId,
      row: cluster.row,
      cross: cluster.cross,
      crossSize: cluster.crossSize,
      count: cluster.members.length,
    });
  }
  entries.sort((a, b) => a.start - b.start || a.row - b.row || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const index = new Map<string, number>();
  entries.forEach((entry, position) => {
    index.set(entry.id, position);
  });
  const navigator: Navigator = {
    entries,
    lanes: layout.lanes.map((lane) => lane.lane.id),
    crossInset,
    indexOf: (id) => {
      const cluster = clustering?.clusterOf(id);
      return index.get(cluster === undefined ? id : cluster.id) ?? -1;
    },
  };
  byInset = new Map([[crossInset, navigator]]);
  navigators.set(memoKey, byInset);
  return navigator;
}

/** Distance in time between two extents; zero when they overlap. */
function gap(a: NavEntry, b: NavEntry): number {
  return Math.max(0, a.start - b.end, b.start - a.end);
}

/**
 * The entry in the nearest row past `from` in `direction`, closest in time.
 *
 * Rows that hold nothing are skipped, so a step across always lands on an
 * item. On a tie the earlier one wins, which keeps the step reversible in
 * the common case of rows of equally spaced items.
 */
export function rowNeighbour(
  navigator: Navigator,
  from: NavEntry,
  direction: 1 | -1,
): NavEntry | undefined {
  let row: number | undefined;
  for (const entry of navigator.entries) {
    const ahead = direction === 1 ? entry.row > from.row : entry.row < from.row;
    if (ahead && (row === undefined || (direction === 1 ? entry.row < row : entry.row > row))) {
      row = entry.row;
    }
  }
  let best: NavEntry | undefined;
  for (const entry of navigator.entries) {
    if (entry.row !== row) {
      continue;
    }
    if (best === undefined || gap(entry, from) < gap(best, from)) {
      best = entry;
    }
  }
  return best;
}
