/**
 * Editing: what an edit *is*, before anything has changed.
 *
 * Nothing here mutates, persists or draws. An edit leaves this module as a
 * {@link Command} — a pair of patch lists plus its own inverse — and the host
 * decides whether to apply it, store it, send it, or throw it away. That is
 * the one thing a timeline library can give a host that the host cannot
 * cheaply build itself: undo that is not reimplemented per field.
 *
 * Three decisions shape the file:
 *
 * 1. **A command is data.** `inverse` is a lazy, non-enumerable, memoised
 *    property, so `JSON.stringify(command)` is a plain object an undo stack
 *    can be persisted from — while `command.inverse.inverse === command`
 *    still holds by identity. A command that linked its inverse eagerly would
 *    be a reference cycle, and the first host to serialise its undo stack
 *    would find out the hard way.
 * 2. **Patches are built from the item's own values, not from its layout.**
 *    An item known to the day is *drawn* from midnight to midnight, but its
 *    stored `start` is some instant inside that day. Shifting the drawn extent
 *    would silently rewrite the data to the grid; shifting the stored value
 *    keeps the edit reversible and the data the host's own.
 * 3. **The before-patch carries exactly the keys the after-patch does.**
 *    An absent key means "unchanged", so an inverse with a different key set
 *    would restore something it was never asked about. {@link createCommand}
 *    checks it rather than trusting it.
 */

import type { Cluster, ClusterMarker } from "./cluster.js";
import { itemRect } from "./layout.js";
import type { ItemSpan, Layout, LayoutItem } from "./layout.js";
import { hitSlopFor, slopForExtent } from "./responsive.js";
import type { TimeScale } from "./scale.js";
import { toTimeMs } from "./time.js";
import type {
  Command,
  Density,
  Item,
  ItemPatch,
  MainCross,
  PointerKind,
  TimeMs,
} from "./types.js";

/** Which part of an item a pointer is over. */
export type EditPart = "body" | "start" | "end";

/** What an edit gesture is doing. */
export type EditMode = "move" | "resize-start" | "resize-end";

/** The edit {@link EditPart} starts. */
export function modeForPart(part: EditPart): EditMode {
  return part === "body" ? "move" : part === "start" ? "resize-start" : "resize-end";
}

/** An item under the pointer, with everything an edit needs to know about it. */
export interface EditHit<T = unknown> {
  readonly item: Item<T>;
  /** The resolved extent, as laid out. Geometry only — never patched. */
  readonly span: ItemSpan;
  /** The lane the item is currently packed into. */
  readonly laneId: string;
  readonly part: EditPart;
}

/** What is where, in `(main, cross)` space. Supplied to the input machine. */
export interface HitTester<T = unknown> {
  /**
   * The item under a container-relative point, if any.
   *
   * With a `pointerType` the target grows by that pointer's slop — a finger
   * reaches a 2-pixel item. Without one the geometry is exact.
   */
  hitTest(point: MainCross, pointerType?: PointerKind): EditHit<T> | undefined;
  /** An item by id, as a body hit. Needed to drag a whole selection. */
  lookup(id: string): EditHit<T> | undefined;
  /** The lane a cross coordinate falls in, for a drag between lanes. */
  laneAt(cross: number): string | undefined;
  /**
   * The cluster under a point, when the tester was built with a clustering.
   * Grown by the pointer's slop like an item. A tap here is the host's to
   * answer — `clusterZoom` is the default answer.
   */
  clusterAt(point: MainCross, pointerType?: PointerKind): Cluster<T> | undefined;
}

/** How to build a {@link HitTester} from a frame. */
export interface HitTestOptions<T = unknown> {
  readonly layout: Layout<T>;
  readonly scale: TimeScale;
  /**
   * Cross extent the renderer puts before the first lane — the axis band.
   * Without it every hit is off by the height of the axis.
   */
  readonly crossInset?: number;
  /** How far the lanes are scrolled across, in CSS pixels. */
  readonly crossOffset?: number;
  /** Main extent at each end of an item that resizes instead of moving. */
  readonly handleSize?: number;
  /**
   * Smallest main extent an item is *drawn* with, so an instant stays
   * visible. The hit box has to use the same number the renderer does, or the
   * user aims at what they can see and misses.
   */
  readonly minItemMainSize?: number;
  /**
   * The level the frame was drawn at. At `dense` every target reaches the
   * minimum size and resizing is off: a handle on a dot is a handle nobody
   * can hold, and offering it is worse than not.
   */
  readonly density?: Density;
  /**
   * The clusters the frame drew (`RenderResult.clusters`). A clustered item
   * is not drawn, so it is not hit — not even through the slop of a finger
   * aimed at the marker: dragging something nobody can see is not an edit
   * anyone meant. The marker answers {@link HitTester.clusterAt} instead.
   * `lookup` still finds a clustered item, so a selection dragged by one of
   * its visible members carries it along.
   */
  readonly clusters?: readonly ClusterMarker<T>[];
}

const DEFAULT_HANDLE_SIZE = 10;
const DEFAULT_MIN_ITEM_MAIN_SIZE = 3;
/**
 * Handles need room.
 *
 * Below this multiple of the handle size the two handles would meet in the
 * middle and the item could never be moved, only resized. A narrow item is
 * therefore all body — which is also the honest answer: a touch target is
 * grown by the pointer's slop (`responsive.ts`), not by a number fudged here.
 */
const HANDLE_ROOM_FACTOR = 3;

/** The raw stored start of an item, normalised. */
function rawStart(item: Item<unknown>): TimeMs {
  return toTimeMs(item.start);
}

/** The raw stored end of an item, or `undefined` for an instant. */
function rawEnd(item: Item<unknown>): TimeMs | undefined {
  return item.end === undefined ? undefined : toTimeMs(item.end);
}

/**
 * Snap a time onto a grid.
 *
 * The grid is anchored at `origin` — the epoch by default, which puts a
 * day-sized grid on UTC midnights. A host that wants local midnights, or a
 * week starting on Monday, moves the origin rather than asking for a mode.
 */
export function snapTime(time: TimeMs, snapMs: number | undefined, origin: TimeMs = 0): TimeMs {
  if (snapMs === undefined || !(snapMs > 0) || !Number.isFinite(snapMs)) {
    return time;
  }
  return origin + Math.round((time - origin) / snapMs) * snapMs;
}

/** How a move is tuned. */
export interface MoveOptions {
  /** How far to shift the item along the time axis. */
  readonly deltaMs: number;
  /** The lane to drop it in. `null` clears the lane. Omit to keep it. */
  readonly laneId?: string | null | undefined;
  readonly snapMs?: number | undefined;
  readonly snapOrigin?: TimeMs | undefined;
}

/**
 * The patch that moves one item.
 *
 * The *start* is snapped and the duration is preserved, rather than snapping
 * both edges: snapping the end as well would stretch or squash an item whose
 * duration is not a multiple of the grid, which is not what dragging it
 * means.
 */
export function movePatch<T>(hit: EditHit<T>, options: MoveOptions): ItemPatch {
  const start = rawStart(hit.item);
  const end = rawEnd(hit.item);
  const snapped = snapTime(start + options.deltaMs, options.snapMs, options.snapOrigin);
  const shift = snapped - start;
  const patch: {
    id: string;
    start: TimeMs;
    end?: TimeMs;
    laneId?: string | null;
  } = { id: hit.item.id, start: snapped };
  if (end !== undefined) {
    patch.end = end + shift;
  }
  if (options.laneId !== undefined && options.laneId !== (hit.item.laneId ?? null)) {
    patch.laneId = options.laneId;
  }
  return patch;
}

/** How a resize is tuned. */
export interface ResizeOptions {
  readonly edge: "start" | "end";
  /** How far to move that edge along the time axis. */
  readonly deltaMs: number;
  readonly snapMs?: number | undefined;
  readonly snapOrigin?: TimeMs | undefined;
  /** Smallest duration the item may be squashed to. One grid step by default. */
  readonly minDurationMs?: number | undefined;
}

/**
 * The patch that moves one edge of an item, or `undefined` when that edge
 * cannot be moved.
 *
 * The far edge never moves, and the near edge never crosses it: an item
 * dragged past its own start clamps to the minimum duration instead of
 * flipping. A flip is a different edit — the host can express it, the gesture
 * will not do it by accident.
 */
export function resizePatch<T>(hit: EditHit<T>, options: ResizeOptions): ItemPatch | undefined {
  const start = rawStart(hit.item);
  const end = rawEnd(hit.item);
  const minDuration = options.minDurationMs ?? (options.snapMs !== undefined && options.snapMs > 0 ? options.snapMs : 1);

  if (options.edge === "start") {
    const wanted = snapTime(start + options.deltaMs, options.snapMs, options.snapOrigin);
    const ceiling = end === undefined ? Number.POSITIVE_INFINITY : end - minDuration;
    const next = Math.min(wanted, ceiling);
    return next === start ? undefined : { id: hit.item.id, start: next };
  }

  if (hit.item.open === true) {
    // No known end, so there is no end to drag. Reaching past the viewport is
    // the point of an open interval.
    return undefined;
  }
  // An instant has no stored end, but it does have a drawn one: dragging that
  // edge turns it into an interval, which is the shortest path from "it
  // happened" to "it lasted".
  const from = end ?? hit.span.end;
  const wanted = snapTime(from + options.deltaMs, options.snapMs, options.snapOrigin);
  const next = Math.max(wanted, start + minDuration);
  return next === end ? undefined : { id: hit.item.id, end: next };
}

/**
 * The patch that puts an item back exactly as it is now.
 *
 * Only the keys `patch` touches are restored. That is the whole reason undo is
 * exact rather than approximately right: an inverse that also restored a field
 * nobody changed would overwrite whatever the host did to it in between.
 */
export function invertPatch<T>(hit: EditHit<T>, patch: ItemPatch): ItemPatch {
  const restored: {
    id: string;
    start?: TimeMs;
    end?: TimeMs | null;
    laneId?: string | null;
  } = { id: hit.item.id };
  if ("start" in patch) {
    restored.start = rawStart(hit.item);
  }
  if ("end" in patch) {
    const end = rawEnd(hit.item);
    restored.end = end ?? null;
  }
  if ("laneId" in patch) {
    restored.laneId = hit.item.laneId ?? null;
  }
  return restored;
}

interface CommandFields {
  type: string;
  label?: string;
  before: readonly ItemPatch[];
  after: readonly ItemPatch[];
}

function keysOf(patch: ItemPatch): string {
  return Object.keys(patch).sort().join(",");
}

function build(
  type: string,
  label: string | undefined,
  before: readonly ItemPatch[],
  after: readonly ItemPatch[],
  twin: Command | undefined,
): Command {
  const command: CommandFields = { type, before, after };
  if (label !== undefined) {
    command.label = label;
  }
  let inverse = twin;
  Object.defineProperty(command, "inverse", {
    // Not enumerable, so a command serialises to its own fields instead of
    // recursing forever: the undo stack a host persists is plain JSON.
    enumerable: false,
    configurable: false,
    get(): Command {
      inverse ??= build(type, label, after, before, command as unknown as Command);
      return inverse;
    },
  });
  return command as unknown as Command;
}

/**
 * A reversible command from a before/after pair.
 *
 * The pairing is checked, not assumed: same length, same ids in the same
 * order, and the same keys on each side. A command that fails those is not
 * an edit that happens to be hard to undo — it is one whose inverse would
 * quietly restore the wrong thing, and the cheapest place to find that out is
 * here.
 */
export function createCommand(
  type: string,
  before: readonly ItemPatch[],
  after: readonly ItemPatch[],
  label?: string,
): Command {
  if (before.length !== after.length) {
    throw new RangeError(
      `A command needs one before-patch per after-patch, got ${String(before.length)} and ${String(after.length)}`,
    );
  }
  for (let index = 0; index < before.length; index += 1) {
    const from = before[index];
    const to = after[index];
    if (from === undefined || to === undefined) {
      throw new RangeError(`Command patch ${String(index)} is missing`);
    }
    if (from.id !== to.id) {
      throw new RangeError(
        `Command patch ${String(index)} describes "${from.id}" before and "${to.id}" after`,
      );
    }
    if (keysOf(from) !== keysOf(to)) {
      throw new RangeError(
        `Command patch for "${from.id}" changes [${keysOf(to)}] but restores [${keysOf(from)}]`,
      );
    }
  }
  return build(type, label, before, after, undefined);
}

/**
 * The command for an edit, with its before-patches read off the hits.
 *
 * `hits` and `after` line up by index: the patch at `i` describes the item hit
 * at `i`.
 */
export function editCommand<T>(
  type: string,
  hits: readonly EditHit<T>[],
  after: readonly ItemPatch[],
  label?: string,
): Command {
  const before = after.map((patch, index) => {
    const hit = hits[index];
    if (hit === undefined) {
      throw new RangeError(`No hit for patch ${String(index)}`);
    }
    return invertPatch(hit, patch);
  });
  return createCommand(type, before, after, label);
}

/**
 * Apply patches to an item list, returning a new list.
 *
 * Untouched items come back by reference, so a host can diff the result and a
 * round trip through a command and its inverse is identical rather than
 * merely equal. A patch for an id that is no longer there is ignored: an undo
 * that threw because the host had since deleted the item would strand the
 * whole stack.
 */
export function applyPatches<T>(
  items: readonly Item<T>[],
  patches: readonly ItemPatch[],
): Item<T>[] {
  if (patches.length === 0) {
    return [...items];
  }
  const byId = new Map<string, ItemPatch[]>();
  for (const patch of patches) {
    const bucket = byId.get(patch.id);
    if (bucket === undefined) {
      byId.set(patch.id, [patch]);
    } else {
      bucket.push(patch);
    }
  }
  return items.map((item) => {
    const bucket = byId.get(item.id);
    if (bucket === undefined) {
      return item;
    }
    let next = item;
    for (const patch of bucket) {
      const draft: Record<string, unknown> = { ...next };
      if ("start" in patch && patch.start !== undefined) {
        draft.start = patch.start;
      }
      if ("end" in patch) {
        if (patch.end === null) {
          // An instant again. The key goes away rather than holding
          // `undefined`: an item with an explicit `end: undefined` and one
          // without an end are the same timeline and should be the same
          // object.
          delete draft.end;
        } else if (patch.end !== undefined) {
          draft.end = patch.end;
        }
      }
      if ("laneId" in patch) {
        if (patch.laneId === null) {
          delete draft.laneId;
        } else if (patch.laneId !== undefined) {
          draft.laneId = patch.laneId;
        }
      }
      next = draft as unknown as Item<T>;
    }
    return next;
  });
}

/**
 * Build a hit tester from a laid-out frame.
 *
 * Pure, and in `(main, cross)` space, so a vertical timeline hit-tests through
 * the same code as a horizontal one. The host rebuilds it when the frame
 * changes — it is a view of that frame, not a cache of it.
 */
export function createHitTester<T>(options: HitTestOptions<T>): HitTester<T> {
  const layout = options.layout;
  const scale = options.scale;
  const crossInset = options.crossInset ?? 0;
  const crossOffset = options.crossOffset ?? 0;
  const handleSize = options.handleSize ?? DEFAULT_HANDLE_SIZE;
  const minMain = options.minItemMainSize ?? DEFAULT_MIN_ITEM_MAIN_SIZE;
  const density = options.density ?? "comfortable";
  const markers = options.clusters ?? [];
  const hidden = new Set(markers.flatMap((marker) => marker.cluster.members.map((member) => member.item.id)));
  const clustered = (placed: LayoutItem<T>): boolean => hidden.has(placed.item.id);

  /** Container-relative point to the layout's own cross space. */
  function toContentCross(cross: number): number {
    return cross - crossInset + crossOffset;
  }

  function hitFor(index: number, part: EditPart): EditHit<T> | undefined {
    const placed = layout.items[index];
    return placed === undefined
      ? undefined
      : { item: placed.item, span: placed.span, laneId: placed.laneId, part };
  }

  /** Whether the pointer is exactly on the drawn item, and on which part. */
  function exactHit(point: MainCross, contentCross: number): EditHit<T> | undefined {
    // Last drawn wins: the renderer emits items in layout order, so the one
    // a user sees on top is the one further down the list.
    for (let index = layout.items.length - 1; index >= 0; index -= 1) {
      const placed = layout.items[index];
      if (placed === undefined || clustered(placed)) {
        continue;
      }
      if (contentCross < placed.cross || contentCross > placed.cross + placed.crossSize) {
        continue;
      }
      const rect = itemRect(placed, scale);
      const mainSize = Math.max(rect.mainSize, minMain);
      if (point.main < rect.main || point.main > rect.main + mainSize) {
        continue;
      }
      if (
        density === "dense" ||
        placed.item.resizable === false ||
        mainSize < handleSize * HANDLE_ROOM_FACTOR
      ) {
        return hitFor(index, "body");
      }
      if (point.main <= rect.main + handleSize) {
        return hitFor(index, "start");
      }
      if (placed.item.open !== true && point.main >= rect.main + mainSize - handleSize) {
        return hitFor(index, "end");
      }
      return hitFor(index, "body");
    }
    return undefined;
  }

  /**
   * The nearest item within the pointer's slop.
   *
   * Only asked once nothing was hit exactly, so a larger zone never steals a
   * neighbour from a precise aim. And it is always a body hit: the slop
   * grows the *target*, not the handles — a finger landing just before an
   * item would otherwise start a resize where the user meant to pan.
   */
  function slopHit(
    point: MainCross,
    contentCross: number,
    base: number,
  ): EditHit<T> | undefined {
    let best: number | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let index = layout.items.length - 1; index >= 0; index -= 1) {
      const placed = layout.items[index];
      if (placed === undefined || clustered(placed)) {
        continue;
      }
      const rect = itemRect(placed, scale);
      const mainSize = Math.max(rect.mainSize, minMain);
      const offMain = Math.max(rect.main - point.main, point.main - (rect.main + mainSize), 0);
      const offCross = Math.max(
        placed.cross - contentCross,
        contentCross - (placed.cross + placed.crossSize),
        0,
      );
      if (
        offMain > slopForExtent(base, mainSize, density) ||
        offCross > slopForExtent(base, placed.crossSize, density)
      ) {
        continue;
      }
      // Strictly nearer: on a tie the one drawn on top keeps it.
      const distance = Math.hypot(offMain, offCross);
      if (distance < bestDistance) {
        best = index;
        bestDistance = distance;
      }
    }
    return best === undefined ? undefined : hitFor(best, "body");
  }

  return {
    hitTest(point, pointerType) {
      const contentCross = toContentCross(point.cross);
      const exact = exactHit(point, contentCross);
      if (exact !== undefined || pointerType === undefined) {
        return exact;
      }
      return slopHit(point, contentCross, hitSlopFor(pointerType));
    },
    lookup(id) {
      for (let index = 0; index < layout.items.length; index += 1) {
        if (layout.items[index]?.item.id === id) {
          return hitFor(index, "body");
        }
      }
      return undefined;
    },
    clusterAt(point, pointerType) {
      // Without a pointer type the geometry is exact, as for an item.
      const slop = (extent: number): number =>
        pointerType === undefined ? 0 : slopForExtent(hitSlopFor(pointerType), extent, density);
      let best: Cluster<T> | undefined;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const { cluster, box } of markers) {
        const offMain = Math.max(box.main - point.main, point.main - (box.main + box.mainSize), 0);
        const offCross = Math.max(box.cross - point.cross, point.cross - (box.cross + box.crossSize), 0);
        if (offMain > slop(box.mainSize) || offCross > slop(box.crossSize)) {
          continue;
        }
        // The nearest wins — distance 0 when the point is on the marker — and
        // the first on a tie.
        const distance = Math.hypot(offMain, offCross);
        if (distance < bestDistance) {
          best = cluster;
          bestDistance = distance;
        }
      }
      return best;
    },
    laneAt(cross) {
      const contentCross = toContentCross(cross);
      for (const lane of layout.lanes) {
        if (contentCross >= lane.cross && contentCross <= lane.cross + lane.crossSize) {
          return lane.lane.id;
        }
      }
      return undefined;
    },
  };
}
