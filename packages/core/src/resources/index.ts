/**
 * `@temporeum/timeline-core/resources` — a timeline of who does what.
 *
 * A resource view is a timeline whose lanes are resources — people, rooms,
 * machines — and whose items are the work assigned to them. This entry point
 * adds what such a view needs beyond that: how loaded each resource is at
 * every moment, where it is booked past what it can do, and the room to draw
 * both. Moving work between resources is the move the base entry point
 * already has: a drag, or `Alt` with an arrow, that changes an item's lane —
 * one reversible command.
 *
 * Four decisions shape it:
 *
 * 1. **A resource is a lane.** {@link resourceLanes} makes the lanes; an
 *    assignment is an item whose `laneId` names a resource, taking
 *    `unitsOf(item)` of it — one by default. A resource that is a group's
 *    lane works the same, so a team can be a group of people.
 * 2. **The load is exact.** {@link resourceLoad} sweeps each resource's
 *    assignments once: between two consecutive edges the load is the sum of
 *    the units of what runs there, and it is over when that passes the
 *    resource's capacity. No sampling, no buckets: an overload one minute
 *    long is found at any zoom.
 * 3. **The load has a row of its own.** Under each resource's lane a load
 *    lane ({@link withLoadLanes}), which holds no items, draws the load as a
 *    histogram against the capacity. Drawn under the items' lane, it would be
 *    hidden exactly where there is work. A key or a drag never lands in it:
 *    {@link loadLaneOf} names the resource it belongs to.
 * 4. **A few paths, culled like the arrows.** The histogram, the capacity
 *    lines and the overload bands are four paths in a layer under the items
 *    ({@link withLoadLayer}), made only for the lanes and the time in view
 *    ({@link loadNodes}): 500 resources cost what the ones on screen cost.
 *
 * The unscheduled tasks — the backlog — are the tasks not on the timeline
 * yet ({@link unscheduledTasks}): placing one is an add, and undoing the add
 * puts it back on the list, with nothing else to keep in step.
 */

import { describeItem } from "../a11y.js";
import { DEFAULT_TIME_ZONE } from "../calendar.js";
import { defaultItemNode } from "../render.js";
import type { RenderHooks } from "../render.js";
import type { Layout, LayoutItem } from "../layout.js";
import type { SceneElement } from "../scene.js";
import type { TimeScale } from "../scale.js";
import type { ResourceStrings } from "../strings.js";
import { toTimeMs } from "../time.js";
import type { Item, Lane, Orientation, TimeMs } from "../types.js";

/** One resource: a lane that work is assigned to. */
export interface Resource {
  /** The lane's id: an assignment names it as its `laneId`. */
  readonly id: string;
  readonly label?: string;
  /** How many units of work it takes at once. 1 by default; 0 takes none. */
  readonly capacity?: number;
}

/** How the load is measured. */
export interface LoadOptions<T = unknown> {
  /**
   * How much of its resource an assignment takes: 1 is all of a capacity of
   * one, 0.5 half of it. 1 by default. Anything not above zero counts nothing.
   */
  readonly unitsOf?: (item: Item<T>) => number;
}

/** One stretch of a resource's time with the same load. */
export interface LoadSegment {
  readonly start: TimeMs;
  /** `Infinity` when an open assignment runs on. */
  readonly end: TimeMs;
  /** The sum of the units of every assignment running in it. */
  readonly load: number;
  /** The load is above the capacity. */
  readonly over: boolean;
}

/** Every resource's load. */
export interface ResourceLoad {
  /** Each resource's capacity, as measured against. */
  readonly capacity: ReadonlyMap<string, number>;
  /** Each resource's stretches with work, in time order; the time between has none. */
  readonly segments: ReadonlyMap<string, readonly LoadSegment[]>;
}

/**
 * How far past the capacity a load has to be to be over. Units add as
 * floating-point numbers: three thirds can come to a hair above one, which
 * is not an overload.
 */
export const LOAD_EPSILON = 1e-9;

/** A resource's capacity: its own, when it is a number not below zero, else 1. */
export function capacityOf(resource: Resource): number {
  const capacity = resource.capacity;
  return capacity !== undefined && Number.isFinite(capacity) && capacity >= 0 ? capacity : 1;
}

const loadCache = new WeakMap<readonly Item<unknown>[], { resources: readonly Resource[]; unitsOf: unknown; load: ResourceLoad }>();

/**
 * Every resource's load from its assignments: an item whose `laneId` is a
 * resource, with an end after its start. An instant, a background band and
 * an item of no resource take nothing; an `open` one runs on for ever.
 *
 * Kept per items array, resources array and `unitsOf`: a frame asks again
 * for the same three and gets the same object back.
 */
export function resourceLoad<T>(items: readonly Item<T>[], resources: readonly Resource[], options: LoadOptions<T> = {}): ResourceLoad {
  const unitsOf = options.unitsOf;
  const hit = loadCache.get(items as readonly Item<unknown>[]);
  if (hit !== undefined && hit.resources === resources && hit.unitsOf === unitsOf) return hit.load;
  const capacity = new Map(resources.map((resource) => [resource.id, capacityOf(resource)]));
  // Per resource: [time, units] for every edge, a start adding and an end taking away.
  const edges = new Map<string, [number, number][]>();
  for (const item of items) {
    const id = item.laneId;
    if (id === undefined || item.kind === "background" || !capacity.has(id)) continue;
    const start = toTimeMs(item.start);
    const end = item.open === true ? Infinity : item.end === undefined ? start : toTimeMs(item.end);
    const units = unitsOf === undefined ? 1 : unitsOf(item);
    if (!(end > start) || !(units > 0) || !Number.isFinite(units)) continue;
    let list = edges.get(id);
    if (list === undefined) {
      list = [];
      edges.set(id, list);
    }
    list.push([start, units], [end, -units]);
  }
  const segments = new Map<string, LoadSegment[]>();
  for (const resource of resources) {
    const list = (edges.get(resource.id) ?? []).sort((a, b) => a[0] - b[0]);
    const limit = capacity.get(resource.id) as number;
    const out: LoadSegment[] = [];
    let load = 0;
    let running = 0;
    let at = 0;
    for (let index = 0; index < list.length; ) {
      const time = (list[index] as [number, number])[0];
      if (running > 0 && time > at) {
        const last = out[out.length - 1];
        // The same load on: one stretch, not two.
        if (last !== undefined && last.end === at && last.load === load) out[out.length - 1] = { ...last, end: time };
        else out.push({ start: at, end: time, load, over: load > limit + LOAD_EPSILON });
      }
      // Every edge at this time, then the next stretch.
      for (; index < list.length && (list[index] as [number, number])[0] === time; index += 1) {
        const units = (list[index] as [number, number])[1];
        load += units;
        running += units > 0 ? 1 : -1;
      }
      // Nothing running is exactly nothing, whatever the sums left behind.
      if (running === 0) load = 0;
      at = time;
    }
    segments.set(resource.id, out);
  }
  const result: ResourceLoad = { capacity, segments };
  loadCache.set(items as readonly Item<unknown>[], { resources, unitsOf, load: result });
  return result;
}

/** Index of the first segment that ends after `time`. */
function firstAfter(segments: readonly LoadSegment[], time: TimeMs): number {
  let low = 0;
  let high = segments.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if ((segments[mid] as LoadSegment).end <= time) low = mid + 1;
    else high = mid;
  }
  return low;
}

/** A resource's load at a moment: 0 where nothing runs and for a resource not in `load`. */
export function loadAt(load: ResourceLoad, resourceId: string, time: TimeMs): number {
  const segments = load.segments.get(resourceId) ?? [];
  const segment = segments[firstAfter(segments, time)];
  return segment !== undefined && segment.start <= time ? segment.load : 0;
}

/** The stretches in `[start, end)` where a resource is over its capacity. */
export function overloads(load: ResourceLoad, resourceId: string, start: TimeMs = -Infinity, end: TimeMs = Infinity): LoadSegment[] {
  const segments = load.segments.get(resourceId) ?? [];
  const out: LoadSegment[] = [];
  for (let index = firstAfter(segments, start); index < segments.length; index += 1) {
    const segment = segments[index] as LoadSegment;
    if (segment.start >= end) break;
    if (segment.over) out.push(segment);
  }
  return out;
}

// --- lanes -------------------------------------------------------------------

/**
 * The prefix of a load lane's id; what follows is its resource's. A
 * private-use character, so no id a host writes begins with it, and an XML
 * one, so a frame that names the lane is still a document when exported.
 */
export const LOAD_LANE_PREFIX = "\uE000l:";

/** The id of a resource's load lane. */
export function loadLaneId(resourceId: string): string {
  return LOAD_LANE_PREFIX + resourceId;
}

/** The resource a load lane belongs to, or `undefined` for any other lane. */
export function loadLaneOf(laneId: string): string | undefined {
  return laneId.startsWith(LOAD_LANE_PREFIX) ? laneId.slice(LOAD_LANE_PREFIX.length) : undefined;
}

/** One lane per resource, in their order. */
export function resourceLanes(resources: readonly Resource[]): Lane[] {
  return resources.map((resource) => (resource.label === undefined ? { id: resource.id } : { id: resource.id, label: resource.label }));
}

/**
 * The lanes with a load lane after each resource's lane: `size` across,
 * holding no items, named after its resource. A lane of no resource — a
 * group's header, a lane of other things — gets none.
 */
export function withLoadLanes(lanes: readonly Lane[], resources: readonly Resource[], size = 24, say?: ResourceSay): Lane[] {
  const known = new Set(resources.map((resource) => resource.id));
  const out: Lane[] = [];
  for (const lane of lanes) {
    out.push(lane);
    if (known.has(lane.id)) {
      const name = lane.label ?? lane.id;
      out.push({ id: loadLaneId(lane.id), label: say?.("loadLane", { lane: name }) ?? `${name} load`, packMode: "single", minCrossSize: size });
    }
  }
  return out;
}

// --- drawing -----------------------------------------------------------------

/** Where the load is drawn. */
export interface LoadDrawOptions {
  /** The scale the items are drawn at: the view's, or a space's. */
  readonly scale: TimeScale;
  readonly orientation: Orientation;
  /** The axis band's size across: lanes start after it. */
  readonly crossInset?: number;
  /** How far the lanes are scrolled across. */
  readonly crossOffset?: number;
  /** Draw only what meets this range — main and cross, in the drawing's pixels. Without one, the scale's view and every lane. */
  readonly clip?: { readonly main: readonly [number, number]; readonly cross: readonly [number, number] };
}

/** How high the capacity is in a load lane: two thirds, so half as much again still fits. */
const CAPACITY_SHARE = 2 / 3;
/** Room kept free at each side of a load lane, across. */
const LOAD_PAD = 2;

const LOAD_STYLE = "fill:var(--tl-accent);fill-opacity:.35;pointer-events:none";
const OVER_STYLE = "fill:var(--tl-now);fill-opacity:.8;pointer-events:none";
const BAND_STYLE = "fill:var(--tl-now);fill-opacity:.16;pointer-events:none";
const CAPACITY_STYLE = "fill:none;stroke:var(--tl-line-strong);stroke-width:1;stroke-dasharray:3 2;vector-effect:non-scaling-stroke;pointer-events:none";

function num(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

/**
 * The load as at most four paths, in the drawing's pixels:
 *
 *  - `tl-load`: in each load lane, a bar per stretch of work, as high as
 *    its share of the capacity — the capacity at two thirds of the lane, a
 *    load half as much again or more filling it;
 *  - `tl-load tl-load--over`: the bars of the stretches over capacity;
 *  - `tl-capacity`: the capacity, a dashed line across each load lane;
 *  - `tl-overload`: in each resource's own lane, a band over the stretches
 *    it is overbooked, under its items.
 *
 * Only lanes across the clip, and stretches along it, are drawn.
 */
export function loadNodes<T>(layout: Layout<T>, load: ResourceLoad, options: LoadDrawOptions): SceneElement[] {
  const scale = options.scale;
  const horizontal = options.orientation === "horizontal";
  const shift = (options.crossInset ?? 0) - (options.crossOffset ?? 0);
  const main = options.clip?.main ?? [0, scale.mainSize];
  const cross = options.clip?.cross ?? [-Infinity, Infinity];
  const from = scale.toTime(main[0]);
  const to = scale.toTime(main[1]);
  const box = (main0: number, main1: number, cross0: number, cross1: number): string =>
    horizontal
      ? `M${num(main0)} ${num(cross0)}H${num(main1)}V${num(cross1)}H${num(main0)}Z`
      : `M${num(cross0)} ${num(main0)}V${num(main1)}H${num(cross1)}V${num(main0)}Z`;
  let bars = "";
  let over = "";
  let bands = "";
  let lines = "";
  for (const lane of layout.lanes) {
    const top = lane.cross + shift;
    const bottom = top + lane.crossSize;
    if (bottom < cross[0] || top > cross[1]) continue;
    const loadOf = loadLaneOf(lane.lane.id);
    const id = loadOf ?? lane.lane.id;
    const segments = load.segments.get(id);
    if (segments === undefined) continue;
    const capacity = load.capacity.get(id) as number;
    const inner = Math.max(lane.crossSize - 2 * LOAD_PAD, 0);
    // Across a horizontal timeline the bars stand on the lane's far edge;
    // across a vertical one they grow from the lane's start.
    const base = horizontal ? bottom - LOAD_PAD : top + LOAD_PAD;
    const toward = horizontal ? -1 : 1;
    if (loadOf !== undefined) {
      const level = base + toward * inner * CAPACITY_SHARE;
      lines += horizontal ? `M${num(main[0])} ${num(level)}H${num(main[1])}` : `M${num(level)} ${num(main[0])}V${num(main[1])}`;
    }
    for (let index = firstAfter(segments, from); index < segments.length; index += 1) {
      const segment = segments[index] as LoadSegment;
      if (segment.start >= to) break;
      const main0 = Math.max(scale.toMain(segment.start), main[0]);
      const main1 = Math.min(scale.toMain(segment.end), main[1]);
      if (!(main1 > main0)) continue;
      if (loadOf === undefined) {
        if (segment.over) bands += box(main0, main1, top, bottom);
        continue;
      }
      const share = capacity > 0 ? Math.min(segment.load / capacity, 1 / CAPACITY_SHARE) : 1 / CAPACITY_SHARE;
      const tip = base + toward * inner * CAPACITY_SHARE * share;
      const path = box(main0, main1, Math.min(base, tip), Math.max(base, tip));
      if (segment.over) over += path;
      else bars += path;
    }
  }
  const nodes: SceneElement[] = [];
  const path = (className: string, d: string, style: string): void => {
    if (d !== "") nodes.push({ tag: "path", attrs: { class: className, d, style } });
  };
  path("tl-overload", bands, BAND_STYLE);
  path("tl-load", bars, LOAD_STYLE);
  path("tl-load tl-load--over", over, OVER_STYLE);
  path("tl-capacity", lines, CAPACITY_STYLE);
  return nodes;
}

/** The load's layer class. */
export const LOAD_LAYER = "tl-layer--load";

/**
 * A frame with the load in it: a layer before the item layer — and before
 * the dependency arrows, when they are added after — with the item layer's
 * transform, so the load moves with the items. A frame without an item layer
 * comes back as it was.
 */
export function withLoadLayer(scene: SceneElement, nodes: readonly SceneElement[]): SceneElement {
  const children = scene.children ?? [];
  const at = children.findIndex((child) => child.tag === "g" && String(child.attrs?.class ?? "").includes("tl-layer--items"));
  const items = children[at];
  if (items === undefined) return scene;
  const layer: SceneElement = {
    tag: "g",
    attrs: { class: `tl-layer ${LOAD_LAYER}`, transform: items.attrs?.transform, "aria-hidden": "true" },
    children: nodes,
  };
  return { ...scene, children: [...children.slice(0, at), layer, ...children.slice(at)] };
}

// --- the items ---------------------------------------------------------------

/** What the resource hooks need. */
export interface ResourceHookOptions {
  readonly load: ResourceLoad;
  /** Lane names, for the default accessible name. */
  readonly lanes?: ReadonlyMap<string, string | undefined>;
  readonly locale?: string;
  readonly timeZone?: string;
  /** The names' words from a dictionary: `sayIn` in `/intl`. The built-in English without it. */
  readonly say?: ResourceSay;
}

/**
 * The words of a phrase of {@link ResourceStrings}, filled in — `/intl`'s
 * dictionary, or a host's. Without one the view says the built-in English,
 * which is the dictionary's own (`RESOURCE_STRINGS`).
 */
export type ResourceSay = (key: keyof ResourceStrings, values?: Readonly<Record<string, string | number>>) => string;

export type { ResourceStrings } from "../strings.js";

/** The highest load of a resource in `[start, end)`, and whether it is over. */
export function peakLoad(load: ResourceLoad, resourceId: string, start: TimeMs, end: TimeMs): { readonly load: number; readonly over: boolean } {
  const segments = load.segments.get(resourceId) ?? [];
  let peak = 0;
  let over = false;
  for (let index = firstAfter(segments, start); index < segments.length; index += 1) {
    const segment = segments[index] as LoadSegment;
    if (segment.start >= end) break;
    peak = Math.max(peak, segment.load);
    over ||= segment.over;
  }
  return { load: peak, over };
}

/**
 * What an assignment's accessible name adds when its resource is overbooked
 * while it runs: "overbooked, 150% of capacity". Empty otherwise.
 */
export function describeOverload<T>(placed: LayoutItem<T>, load: ResourceLoad, say?: ResourceSay): string {
  const capacity = load.capacity.get(placed.laneId);
  if (capacity === undefined) return "";
  const peak = peakLoad(load, placed.laneId, placed.span.start, placed.span.end);
  if (!peak.over) return "";
  if (!(capacity > 0)) return say?.("overbookedNoCapacity") ?? "overbooked, no capacity";
  const percent = Math.round((peak.load / capacity) * 100);
  return say?.("overbooked", { percent, count: percent }) ?? `overbooked, ${String(percent)}% of capacity`;
}

/**
 * Render hooks for a resource view, over whatever hooks there were: an
 * assignment running while its resource is overbooked gets the
 * `tl-item--overbooked` class and a red edge, and its accessible name says
 * so.
 */
export function resourceHooks<T>(hooks: RenderHooks<T> = {}, options: ResourceHookOptions): RenderHooks<T> {
  const base = hooks.renderItem ?? defaultItemNode;
  const describe = hooks.describeItem;
  const load = options.load;
  return {
    ...hooks,
    renderItem(context) {
      const node = base(context);
      if (node === null || describeOverload(context.placed, load, options.say) === "") return node;
      const marked: SceneElement = { ...node, attrs: { ...node.attrs, class: `${String(node.attrs?.class ?? "")} tl-item--overbooked`.trim() } };
      // The red edge goes on the shape: a group's (a Gantt task's) is its first child.
      const shape = marked.tag === "g" ? marked.children?.[0] : marked;
      if (shape === undefined) return marked;
      const edged: SceneElement = { ...shape, attrs: { ...shape.attrs, style: `${String(shape.attrs?.style ?? "")};stroke:var(--tl-now);stroke-width:2`.replace(/^;/, "") } };
      return marked === shape ? edged : { ...marked, children: [edged, ...(marked.children ?? []).slice(1)] };
    },
    describeItem(placed) {
      const name =
        describe === undefined
          ? describeItem(placed.item, placed.span, options.lanes?.get(placed.laneId), options.locale ?? "en", options.timeZone ?? DEFAULT_TIME_ZONE)
          : describe(placed);
      const words = describeOverload(placed, load, options.say);
      return words === "" ? name : `${name}${options.say?.("listSeparator") ?? ", "}${words}`;
    },
  };
}

// --- the backlog -------------------------------------------------------------

/** A task not on the timeline yet: an item without its time, and how long it takes. */
export type BacklogTask<T = unknown> = Omit<Item<T>, "start" | "end"> & {
  /** How long it takes once placed. Without one, an add's default length. */
  readonly durationMs?: number;
};

/**
 * The tasks not on the timeline: those whose id no item has. Placing one is
 * an add, and the add's inverse takes it off again — so the list follows
 * the items, and an undo puts a task back on it by itself.
 */
export function unscheduledTasks<T>(tasks: readonly BacklogTask<T>[], items: readonly Item<T>[]): BacklogTask<T>[] {
  const placed = new Set(items.map((item) => item.id));
  return tasks.filter((task) => !placed.has(task.id));
}
