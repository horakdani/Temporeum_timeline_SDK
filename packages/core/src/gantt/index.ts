/**
 * `@temporeum/timeline-core/gantt` — a timeline drawn as a Gantt chart.
 *
 * A Gantt chart is a timeline with four more things on it: arrows between
 * tasks that depend on each other, how far each task has got, the plan it is
 * measured against, and the milestones it is heading for. Beside it, a table
 * of the tasks, one row per lane. This entry point is all of that as pure
 * functions; the browser binding only places what they return.
 *
 * Four decisions shape it:
 *
 * 1. **An arrow is a route, not a curve.** {@link routeDependencies} turns a
 *    dependency into a polyline of axis-aligned segments in `(main, cross)`
 *    space, so the same route is right in both orientations, and a test can
 *    check where it leaves and where it lands: a finish-to-start arrow leaves
 *    its predecessor's end moving forward in time and lands on its
 *    successor's start moving forward in time, whatever the rows between.
 * 2. **Under the items, in their space.** The arrows are a layer of their
 *    own, inserted right before the item layer with the item layer's own
 *    transform ({@link withDependencyLayer}). An item is therefore never
 *    covered by an arrow, and a pan or a zoom step moves the arrows with the
 *    items for the price of the one attribute it already writes. The core
 *    renderer does not know about any of it: its base entry point is full.
 * 3. **Culled by what could be seen.** A route is kept when the box around
 *    its polyline meets the clip range. A segment of a route lies inside that
 *    box, so a route that crosses the view anywhere is always kept, and one
 *    that cannot be seen is never drawn — at 10 000 dependencies that is the
 *    difference between a frame and a stall.
 * 4. **Nothing is scheduled here.** A dependency's lag is part of what it
 *    says, and of its accessible description, but it does not move a task:
 *    computing where a task should be is the scheduler's (`/schedule`), and
 *    saving it is the host's.
 */

import { describeItem } from "../a11y.js";
import { DEFAULT_TIME_ZONE } from "../calendar.js";
import { defaultItemNode } from "../render.js";
import type { ItemRenderContext, RenderHooks } from "../render.js";
import { formatNumber } from "../scene.js";
import type { SceneElement } from "../scene.js";
import type { TimeScale } from "../scale.js";
import type { Layout, LayoutItem, LayoutLane } from "../layout.js";
import type { KeySample } from "../keyboard.js";
import type { GanttStrings } from "../strings.js";
import { toTimeMs } from "../time.js";
import { edgePoint, milestoneHalf } from "./box.js";
import type { Item, MainCross, MainCrossRect, Orientation, TimeInput } from "../types.js";

// --- dependencies ------------------------------------------------------------

/**
 * Which edges a dependency joins: the first letter is the predecessor's
 * edge, the second the successor's — `FS`, finish-to-start, the default,
 * says the successor starts when the predecessor finishes.
 */
export type DependencyType = "FS" | "SS" | "FF" | "SF";

/** One dependency between two items. */
export interface Dependency {
  /** Unique among the dependencies. `from->to` by default. */
  readonly id?: string;
  /** The predecessor's item id. */
  readonly from: string;
  /** The successor's item id. */
  readonly to: string;
  readonly type?: DependencyType;
  /** Delay between the two edges, in milliseconds. Negative is a lead. Described, not drawn. */
  readonly lagMs?: number;
  readonly className?: string;
}

/** A dependency's id: its own, or `from->to`. */
export function dependencyId(dependency: Dependency): string {
  return dependency.id ?? `${dependency.from}->${dependency.to}`;
}

/** The edge of the predecessor (`from`) and of the successor (`to`) a type joins. */
export function dependencyEdges(type: DependencyType = "FS"): { readonly from: "start" | "end"; readonly to: "start" | "end" } {
  return { from: type[0] === "S" ? "start" : "end", to: type[1] === "S" ? "start" : "end" };
}

/** A drawn task's box, as the arrows see it. */
export interface TaskBox extends MainCrossRect {
  readonly placed: LayoutItem;
}

/** Where the boxes are, and how the routes go. */
export interface RouteOptions {
  /** The scale the items are drawn at: the view's, or a space's. */
  readonly scale: TimeScale;
  /** The axis band's size across: lanes start after it. */
  readonly crossInset?: number;
  /** How far the lanes are scrolled across. */
  readonly crossOffset?: number;
  /** Smallest drawn main size of an item, as the renderer draws it. */
  readonly minItemMainSize?: number;
  /** How far an arrow runs straight out of an edge and into one. 8 px by default. */
  readonly stub?: number;
  /** Gap between rows, where a route that has to turn back runs. 4 px by default. */
  readonly rowGap?: number;
  /**
   * Keep only routes whose bounding box meets this range — main and cross,
   * in the same pixels as the routes. Without one, every route is kept.
   */
  readonly clip?: { readonly main: readonly [number, number]; readonly cross: readonly [number, number] };
}

/** One dependency, routed. */
export interface DependencyRoute {
  readonly id: string;
  readonly dependency: Dependency;
  readonly type: DependencyType;
  readonly from: TaskBox;
  readonly to: TaskBox;
  /** Axis-aligned segments from the predecessor's edge to the successor's. */
  readonly points: readonly MainCross[];
  /** The box around the points. */
  readonly bounds: MainCrossRect;
}

const indexCache = new WeakMap<Layout, Map<string, LayoutItem>>();

/** The layout's items by id, kept per layout. */
export function layoutIndex<T>(layout: Layout<T>): ReadonlyMap<string, LayoutItem<T>> {
  let index = indexCache.get(layout as Layout);
  if (index === undefined) {
    index = new Map(layout.items.map((placed) => [placed.item.id, placed as LayoutItem]));
    indexCache.set(layout as Layout, index);
  }
  return index as ReadonlyMap<string, LayoutItem<T>>;
}

/**
 * A placed item's box as drawn, before clipping: its span at the scale,
 * never thinner than the minimum, a milestone as its diamond.
 */
export function taskBox(placed: LayoutItem, options: RouteOptions): TaskBox {
  const scale = options.scale;
  const inset = options.crossInset ?? 0;
  const offset = options.crossOffset ?? 0;
  const cross = placed.cross + inset - offset;
  const start = scale.toMain(placed.span.start);
  if (placed.item.kind === "milestone") {
    const half = milestoneHalf(placed.crossSize);
    return { placed, main: start - half, mainSize: 2 * half, cross, crossSize: placed.crossSize };
  }
  const end = placed.span.open ? Math.max(scale.toMain(scale.domain[1]), start) : scale.toMain(placed.span.end);
  return { placed, main: start, mainSize: Math.max(end - start, options.minItemMainSize ?? 0), cross, crossSize: placed.crossSize };
}

/** Drop repeated points and the middle of three on one line. */
function simplify(points: MainCross[]): MainCross[] {
  const out: MainCross[] = [];
  for (const point of points) {
    const last = out[out.length - 1];
    if (last !== undefined && last.main === point.main && last.cross === point.cross) continue;
    const before = out[out.length - 2];
    // One line on, the same way: the middle point is no turn. A line that
    // doubles back is kept, or the route would lose its direction.
    if (
      before !== undefined &&
      last !== undefined &&
      ((before.main === last.main && last.main === point.main && Math.sign(last.cross - before.cross) === Math.sign(point.cross - last.cross)) ||
        (before.cross === last.cross && last.cross === point.cross && Math.sign(last.main - before.main) === Math.sign(point.main - last.main)))
    ) {
      out[out.length - 1] = point;
      continue;
    }
    out.push(point);
  }
  return out;
}

/**
 * The polyline between two boxes for a type: out of the predecessor's edge
 * along the time axis, across, and into the successor's edge along the time
 * axis — turning back through the gap after the predecessor's row when the
 * successor's edge is behind where the arrow has to go.
 */
export function routePoints(
  from: MainCrossRect,
  to: MainCrossRect,
  options: { readonly type?: DependencyType | undefined; readonly stub?: number | undefined; readonly rowGap?: number | undefined } = {},
): MainCross[] {
  const type = options.type ?? "FS";
  const stub = options.stub ?? 8;
  const rowGap = options.rowGap ?? 4;
  const edges = dependencyEdges(type);
  const s = edgePoint(from, edges.from);
  const e = edgePoint(to, edges.to);
  // +1: along time. Out of an end forward, out of a start backward; into a
  // start forward, into an end backward.
  const out = edges.from === "end" ? 1 : -1;
  const into = edges.to === "start" ? 1 : -1;
  const s1 = s.main + out * stub;
  const e1 = e.main - into * stub;
  let points: MainCross[];
  if (out !== into && s.cross !== e.cross) {
    // SS and FF: one turn, as far out as both stubs need.
    const m = out > 0 ? Math.max(s1, e1) : Math.min(s1, e1);
    points = [s, { main: m, cross: s.cross }, { main: m, cross: e.cross }, e];
  } else if (out === into && (e1 - s1) * out >= 0) {
    // FS (or SF) with room: down at the stub, then straight in.
    points = [s, { main: s1, cross: s.cross }, { main: s1, cross: e.cross }, e];
  } else {
    // The successor's edge is behind (FS, SF), or on the same row as an
    // edge that faces the same way (SS, FF): turn back in the gap after the
    // predecessor's row, on the side of the successor.
    const below = e.cross >= s.cross;
    const mid = below ? from.cross + from.crossSize + rowGap / 2 : from.cross - rowGap / 2;
    points = [s, { main: s1, cross: s.cross }, { main: s1, cross: mid }, { main: e1, cross: mid }, { main: e1, cross: e.cross }, e];
  }
  return simplify(points);
}

function boundsOf(points: readonly MainCross[]): MainCrossRect {
  let main0 = Infinity;
  let main1 = -Infinity;
  let cross0 = Infinity;
  let cross1 = -Infinity;
  for (const point of points) {
    main0 = Math.min(main0, point.main);
    main1 = Math.max(main1, point.main);
    cross0 = Math.min(cross0, point.cross);
    cross1 = Math.max(cross1, point.cross);
  }
  return { main: main0, mainSize: main1 - main0, cross: cross0, crossSize: cross1 - cross0 };
}

/**
 * Route every dependency whose two items are in the layout. A dependency on
 * an item the layout does not hold — a collapsed group's, a window not
 * loaded yet, an unknown id — has nothing to point at and is left out, as
 * is one from an item to itself.
 */
export function routeDependencies<T>(layout: Layout<T>, dependencies: readonly Dependency[], options: RouteOptions): DependencyRoute[] {
  const index = layoutIndex(layout);
  const stub = options.stub ?? 8;
  const gap = options.rowGap ?? 4;
  const clip = options.clip;
  const boxes = new Map<string, TaskBox>();
  const boxOf = (placed: LayoutItem): TaskBox => {
    let box = boxes.get(placed.item.id);
    if (box === undefined) {
      box = taskBox(placed, options);
      boxes.set(placed.item.id, box);
    }
    return box;
  };
  const routes: DependencyRoute[] = [];
  for (const dependency of dependencies) {
    if (dependency.from === dependency.to) continue;
    const from = index.get(dependency.from);
    const to = index.get(dependency.to);
    if (from === undefined || to === undefined) continue;
    if (clip !== undefined) {
      // Across first, at no scale: of 10 000 arrows over 500 lanes, those
      // between the lanes in view — before a box is made for either end.
      const inset = (options.crossInset ?? 0) - (options.crossOffset ?? 0);
      const cross0 = Math.min(from.cross, to.cross) + inset - gap;
      const cross1 = Math.max(from.cross + from.crossSize, to.cross + to.crossSize) + inset + gap;
      if (cross1 < clip.cross[0] || cross0 > clip.cross[1]) continue;
    }
    const a = boxOf(from as LayoutItem);
    const b = boxOf(to as LayoutItem);
    const type = dependency.type ?? "FS";
    if (clip !== undefined) {
      // Cheap reject before routing: every route stays within the two boxes
      // grown by a stub along time and a gap across.
      const main0 = Math.min(a.main, b.main) - stub;
      const main1 = Math.max(a.main + a.mainSize, b.main + b.mainSize) + stub;
      const cross0 = Math.min(a.cross, b.cross) - gap;
      const cross1 = Math.max(a.cross + a.crossSize, b.cross + b.crossSize) + gap;
      if (main1 < clip.main[0] || main0 > clip.main[1] || cross1 < clip.cross[0] || cross0 > clip.cross[1]) continue;
    }
    const points = routePoints(a, b, { type, stub, rowGap: gap });
    const bounds = boundsOf(points);
    if (
      clip !== undefined &&
      (bounds.main + bounds.mainSize < clip.main[0] ||
        bounds.main > clip.main[1] ||
        bounds.cross + bounds.crossSize < clip.cross[0] ||
        bounds.cross > clip.cross[1])
    ) {
      continue;
    }
    routes.push({ id: dependencyId(dependency), dependency, type, from: a, to: b, points, bounds });
  }
  return routes;
}

/** Length of an arrowhead along its segment, and half its width. */
const HEAD_LENGTH = 5;
const HEAD_HALF = 3.5;

/** A route as one SVG path: the line, then the open head at its end. */
export function routePath(points: readonly MainCross[], orientation: Orientation): string {
  // formatNumber's three decimals, without its string work: a route's
  // points are finite, and a pan routes hundreds of them at once.
  const num = (value: number): string => String(Math.round(value * 1000) / 1000);
  const xy = (main: number, cross: number): string => (orientation === "horizontal" ? `${num(main)} ${num(cross)}` : `${num(cross)} ${num(main)}`);
  let d = "";
  points.forEach((point, at) => {
    d += `${at === 0 ? "M" : " L"}${xy(point.main, point.cross)}`;
  });
  const end = points[points.length - 1];
  const before = points[points.length - 2];
  if (end !== undefined && before !== undefined) {
    // The last segment runs along time (routePoints ends that way).
    const dir = Math.sign(end.main - before.main) || 1;
    const back = end.main - dir * HEAD_LENGTH;
    d += ` M${xy(back, end.cross - HEAD_HALF)} L${xy(end.main, end.cross)} L${xy(back, end.cross + HEAD_HALF)}`;
  }
  return d;
}

/** How the arrows are drawn. */
export interface DependencyNodeOptions {
  /** Arrows touching a selected item are drawn stronger. */
  readonly selectedIds?: ReadonlySet<string>;
}

/** An arrow's classes, and whether it is drawn stronger. */
function dependencyLook(route: DependencyRoute, selected: ReadonlySet<string> | undefined): [string, boolean] {
  const strong = selected !== undefined && (selected.has(route.dependency.from) || selected.has(route.dependency.to));
  const className = route.dependency.className;
  return [`tl-dep tl-dep--${route.type.toLowerCase()}${strong ? " tl-dep--selected" : ""}${className === undefined ? "" : ` ${className}`}`, strong];
}

/** The arrows' nodes, one path each. */
export function dependencyNodes(routes: readonly DependencyRoute[], orientation: Orientation, options: DependencyNodeOptions = {}): SceneElement[] {
  return routes.map((route) => {
    const [classes, strong] = dependencyLook(route, options.selectedIds);
    return {
      tag: "path",
      attrs: { class: classes, "data-tl-dep": route.id, d: routePath(route.points, orientation), style: strong ? DEP_STYLE_STRONG : DEP_STYLE },
    };
  });
}

/**
 * The arrows as few paths: one per look — type, selection, class — naming
 * its arrows in `data-tl-dep`, space-separated, the stronger ones last. A
 * path is a draw: at 800 arrows in view, a path each is most of a zoom
 * frame's paint. `pathOf` may hand a route's `d` from a
 * cache.
 */
export function dependencyPaths(
  routes: readonly DependencyRoute[],
  orientation: Orientation,
  options: DependencyNodeOptions = {},
  pathOf: (route: DependencyRoute) => string = (route) => routePath(route.points, orientation),
): SceneElement[] {
  const groups = new Map<string, { ids: string[]; d: string[]; strong: boolean }>();
  for (const route of routes) {
    const [classes, strong] = dependencyLook(route, options.selectedIds);
    let group = groups.get(classes);
    if (group === undefined) {
      group = { ids: [], d: [], strong };
      groups.set(classes, group);
    }
    group.ids.push(route.id);
    group.d.push(pathOf(route));
  }
  return [...groups]
    .sort(([, a], [, b]) => Number(a.strong) - Number(b.strong))
    .map(([classes, group]) => ({
      tag: "path",
      attrs: { class: classes, "data-tl-dep": group.ids.join(" "), d: group.d.join(" "), style: group.strong ? DEP_STYLE_STRONG : DEP_STYLE },
    }));
}

const DEP_STYLE = "fill:none;stroke:var(--tl-line-strong);stroke-width:1.25;vector-effect:non-scaling-stroke";
const DEP_STYLE_STRONG = "fill:none;stroke:var(--tl-focus);stroke-width:2;vector-effect:non-scaling-stroke";

/** The arrows' layer class. */
export const DEPENDENCY_LAYER = "tl-layer--deps";

/**
 * A frame with the arrows in it: a layer right before the item layer, with
 * its transform, so the arrows are under every item and move with them. A
 * frame without an item layer (an empty one) comes back as it was.
 */
export function withDependencyLayer(scene: SceneElement, nodes: readonly SceneElement[]): SceneElement {
  const children = scene.children ?? [];
  const at = children.findIndex((child) => child.tag === "g" && String(child.attrs?.class ?? "").includes("tl-layer--items"));
  const items = children[at];
  if (items === undefined) return scene;
  const layer: SceneElement = {
    tag: "g",
    attrs: {
      class: `tl-layer ${DEPENDENCY_LAYER}`,
      transform: items.attrs?.transform,
      // An interactive frame's item layer is a plain container; every other
      // layer only repeats what the items say, the arrows included.
      "aria-hidden": items.attrs?.role === "none" ? "true" : undefined,
    },
    children: nodes,
  };
  return { ...scene, children: [...children.slice(0, at), layer, ...children.slice(at)] };
}

// --- progress, baseline, milestone -------------------------------------------

/** A progress as a fraction from 0 to 1, or `undefined` when there is none to draw. */
export function progressOf(item: Item<unknown>): number | undefined {
  const value = item.progress;
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return Math.min(Math.max(value, 0), 1);
}

/** What the Gantt hooks need to say about the items. */
export interface GanttHookOptions<T = unknown> {
  readonly dependencies?: readonly Dependency[];
  /** Names of the items, for "after Design" — the item labels by default. */
  readonly items?: readonly Item<T>[];
  readonly lanes?: ReadonlyMap<string, string | undefined>;
  readonly locale?: string;
  readonly timeZone?: string;
  /** The names' words from a dictionary: `sayIn` in `/intl`. The built-in English without it. */
  readonly say?: GanttSay;
}

/** Each item's predecessors and successors. */
export interface DependencyLinks {
  readonly predecessors: ReadonlyMap<string, readonly Dependency[]>;
  readonly successors: ReadonlyMap<string, readonly Dependency[]>;
}

const linkCache = new WeakMap<readonly Dependency[], DependencyLinks>();

/** Predecessors and successors by item id, kept per dependency array. */
export function dependencyLinks(dependencies: readonly Dependency[]): DependencyLinks {
  let links = linkCache.get(dependencies);
  if (links === undefined) {
    const predecessors = new Map<string, Dependency[]>();
    const successors = new Map<string, Dependency[]>();
    for (const dependency of dependencies) {
      if (dependency.from === dependency.to) continue;
      const before = predecessors.get(dependency.to);
      if (before === undefined) predecessors.set(dependency.to, [dependency]);
      else before.push(dependency);
      const after = successors.get(dependency.from);
      if (after === undefined) successors.set(dependency.from, [dependency]);
      else after.push(dependency);
    }
    links = { predecessors, successors };
    linkCache.set(dependencies, links);
  }
  return links;
}

export type { GanttStrings } from "../strings.js";

const TYPE_WORDS: Readonly<Record<DependencyType, string>> = {
  FS: "finish-to-start",
  SS: "start-to-start",
  FF: "finish-to-finish",
  SF: "start-to-finish",
};

function lagWords(lagMs: number | undefined): string {
  if (lagMs === undefined || lagMs === 0) return "";
  const days = Math.abs(lagMs) / 86_400_000;
  const amount = days >= 1 ? `${formatNumber(days, 1)} d` : `${formatNumber(Math.abs(lagMs) / 3_600_000, 1)} h`;
  return lagMs > 0 ? `, lag ${amount}` : `, lead ${amount}`;
}

/**
 * The words of a phrase of {@link GanttStrings}, filled in — `/intl`'s
 * dictionary, or a host's. Without one the hooks say the built-in English,
 * which is the dictionary's own (`GANTT_STRINGS`).
 */
export type GanttSay = (key: keyof GanttStrings, values?: Readonly<Record<string, string | number>>) => string;

function linkWords(dependency: Dependency, name: string, say: GanttSay | undefined): string {
  const type = dependency.type ?? "FS";
  if (say === undefined) return `${name} (${TYPE_WORDS[type]}${lagWords(dependency.lagMs)})`;
  const lag = dependency.lagMs ?? 0;
  const days = Math.abs(lag) / 86_400_000;
  const amount = days >= 1 ? say("days", { count: days }) : say("hours", { count: Math.abs(lag) / 3_600_000 });
  return say(lag === 0 ? "dependency" : lag > 0 ? "dependencyLag" : "dependencyLead", { name, type: say(type), amount });
}

/**
 * What an item's dependencies add to its accessible name:
 * "after Design (finish-to-start); before Launch (finish-to-start, lag 2 d)".
 * Empty when it has none.
 */
export function describeDependencies(id: string, links: DependencyLinks, nameOf: (id: string) => string, say?: GanttSay): string {
  const parts: string[] = [];
  const before = links.predecessors.get(id) ?? [];
  const after = links.successors.get(id) ?? [];
  const list = (dependencies: readonly Dependency[], end: "from" | "to"): string =>
    dependencies.map((dependency) => linkWords(dependency, nameOf(dependency[end]), say)).join(say?.("listSeparator") ?? ", ");
  if (before.length > 0) parts.push(say?.("predecessors", { list: list(before, "from") }) ?? `after ${list(before, "from")}`);
  if (after.length > 0) parts.push(say?.("successors", { list: list(after, "to") }) ?? `before ${list(after, "to")}`);
  return parts.join(say?.("groupSeparator") ?? "; ");
}

/** What a baseline adds to the name: how far the task has slipped from its plan. */
export function describeBaseline(item: Item<unknown>, say?: GanttSay): string {
  const baseline = item.baseline;
  if (baseline === undefined) return "";
  // Like with like: the ends where both have one, the starts where not.
  const ends = baseline.end !== undefined && item.end !== undefined && item.kind !== "milestone";
  const planned = toTimeMs(ends ? (baseline.end as TimeInput) : baseline.start);
  const actual = toTimeMs(ends ? (item.end as TimeInput) : item.start);
  const days = Math.round((actual - planned) / 86_400_000);
  if (say !== undefined) return say(days === 0 ? "onPlan" : days > 0 ? "behindPlan" : "aheadOfPlan", { count: Math.abs(days) });
  return days === 0 ? "on plan" : days > 0 ? `${String(days)} d behind plan` : `${String(-days)} d ahead of plan`;
}

/** The accessible name of a Gantt item: its own, its progress, its plan, its dependencies. */
export function describeTask<T>(placed: LayoutItem<T>, options: GanttHookOptions<T>, base?: (placed: LayoutItem<T>) => string): string {
  const item = placed.item;
  const say = options.say;
  const parts = [
    base === undefined
      ? describeItem(item, placed.span, options.lanes?.get(placed.laneId), options.locale ?? "en", options.timeZone ?? DEFAULT_TIME_ZONE)
      : base(placed),
  ];
  if (item.kind === "milestone") parts.push(say?.("milestone") ?? "milestone");
  const progress = progressOf(item);
  if (progress !== undefined) {
    const percent = Math.round(progress * 100);
    parts.push(say?.("progress", { percent, count: percent }) ?? `${String(percent)}% done`);
  }
  const plan = describeBaseline(item, say);
  if (plan !== "") parts.push(plan);
  if (options.dependencies !== undefined && options.dependencies.length > 0) {
    const labels = labelIndex(options.items ?? []);
    const words = describeDependencies(item.id, dependencyLinks(options.dependencies), (id) => labels.get(id) ?? id, say);
    if (words !== "") parts.push(words);
  }
  return parts.join(say?.("listSeparator") ?? ", ");
}

const labelCache = new WeakMap<readonly Item<unknown>[], Map<string, string>>();

function labelIndex(items: readonly Item<unknown>[]): Map<string, string> {
  let labels = labelCache.get(items);
  if (labels === undefined) {
    labels = new Map(items.map((item) => [item.id, item.label ?? item.id]));
    labelCache.set(items, labels);
  }
  return labels;
}

function xy(context: ItemRenderContext<unknown>, main: number, cross: number): { x: number; y: number } {
  const point = context.projector.projectPoint({ main, cross });
  return { x: point.x, y: point.y };
}

/** A milestone: a diamond centred on its start, as tall as its row. */
function milestoneNode(context: ItemRenderContext<unknown>): SceneElement {
  const item = context.placed.item;
  const centre = context.scale.toMain(context.placed.span.start);
  const half = milestoneHalf(context.box.crossSize);
  const middle = context.box.cross + context.box.crossSize / 2;
  const corners = [
    xy(context, centre - half, middle),
    xy(context, centre, middle - context.box.crossSize / 2),
    xy(context, centre + half, middle),
    xy(context, centre, middle + context.box.crossSize / 2),
  ];
  const classes = ["tl-item", "tl-item--milestone", ...(context.selected ? ["tl-item--selected"] : []), ...(item.className === undefined ? [] : [item.className])];
  return {
    tag: "path",
    attrs: {
      class: classes.join(" "),
      "data-tl-id": item.id,
      d: corners.map((point, at) => `${at === 0 ? "M" : "L"}${formatNumber(point.x)} ${formatNumber(point.y)}`).join(" ") + " Z",
    },
    children: [{ tag: "title", text: context.name }],
  };
}

/** The filled part of a bar, and the plan under it. */
function taskExtras(context: ItemRenderContext<unknown>): SceneElement[] {
  const item = context.placed.item;
  const box = context.box;
  const extras: SceneElement[] = [];
  const progress = progressOf(item);
  if (progress !== undefined && progress > 0 && !context.placed.span.open) {
    const start = context.scale.toMain(context.placed.span.start);
    const end = context.scale.toMain(context.placed.span.end);
    const done = start + Math.max(end - start, 0) * progress;
    const from = Math.max(start, box.main);
    const to = Math.min(done, box.main + box.mainSize);
    if (to > from) {
      const rect = context.projector.projectRect({ main: from, mainSize: to - from, cross: box.cross, crossSize: box.crossSize });
      extras.push({
        tag: "rect",
        attrs: {
          class: "tl-progress",
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          rx: context.metrics.cornerRadius,
          style: "fill:var(--tl-accent);fill-opacity:.45;pointer-events:none",
        },
      });
    }
  }
  const baseline = item.baseline;
  if (baseline !== undefined) {
    const start = context.scale.toMain(toTimeMs(baseline.start));
    const end = baseline.end === undefined ? start : context.scale.toMain(toTimeMs(baseline.end));
    const size = Math.max(box.crossSize / 4, 2);
    const rect = context.projector.projectRect({
      main: start,
      mainSize: Math.max(end - start, context.metrics.minItemMainSize),
      cross: box.cross + box.crossSize - size,
      crossSize: size,
    });
    extras.push({
      tag: "rect",
      attrs: {
        class: "tl-baseline",
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        style: "fill:var(--tl-text-muted);fill-opacity:.6;pointer-events:none",
      },
    });
  }
  return extras;
}

/**
 * A node about to go into a group that carries the item's id: one element
 * per item answers `[data-tl-id]`. The same rule as the item kinds' — kept
 * here, so this entry point does not split a chunk off theirs.
 */
function withoutId(node: SceneElement): SceneElement {
  return node.attrs?.["data-tl-id"] === undefined ? node : { ...node, attrs: { ...node.attrs, "data-tl-id": undefined } };
}

/** Whether an item has anything the Gantt hooks draw differently. */
function isTask(item: Item<unknown>): boolean {
  return item.kind === "milestone" || item.baseline !== undefined || progressOf(item) !== undefined;
}

/**
 * Render hooks for a Gantt chart, over whatever hooks there were: a
 * milestone is a diamond, a task's progress fills its bar, its baseline is a
 * thin bar under it — and every item's accessible name says how far it has
 * got and what it depends on. Items with none of that are drawn by `hooks`
 * as before.
 *
 * The node of a task with extras is a group carrying the item's id, its
 * own node first, so the item is what a pointer hits and what the listbox
 * names: the extras do not take pointers.
 */
export function ganttHooks<T>(hooks: RenderHooks<T> = {}, options: GanttHookOptions<T> = {}): RenderHooks<T> {
  const base = hooks.renderItem ?? defaultItemNode;
  const describe = hooks.describeItem;
  return {
    ...hooks,
    renderItem(context) {
      const item = context.placed.item;
      if (!isTask(item as Item<unknown>)) return base(context);
      if (item.kind === "milestone") return milestoneNode(context as ItemRenderContext<unknown>);
      const node = base(context);
      if (node === null) return null;
      const extras = taskExtras(context as ItemRenderContext<unknown>);
      if (extras.length === 0) return node;
      return { tag: "g", attrs: { "data-tl-id": item.id }, children: [withoutId(node), ...extras] };
    },
    describeItem: (placed) => describeTask(placed, options, describe),
  };
}

// --- keyboard: predecessor and successor -------------------------------------

/** What a dependency key asks for. */
export type DependencyKeyAction = "predecessor" | "successor";

/** `[` goes to a predecessor, `]` to a successor. Any modifier but Shift lets the key through. */
export function resolveDependencyKey(sample: KeySample): DependencyKeyAction | undefined {
  if (sample.ctrlKey || sample.metaKey || sample.altKey) return undefined;
  return sample.key === "[" ? "predecessor" : sample.key === "]" ? "successor" : undefined;
}

/**
 * The item a dependency key goes to. Pressed again from where the last one
 * landed, it goes on to the next predecessor (or successor) of the item it
 * started from, round the list: `origin` and `last` are what the host
 * remembers between presses. `undefined` when there is none.
 */
export function dependencyKeyStep(
  dependencies: readonly Dependency[],
  focusedId: string | null,
  action: DependencyKeyAction,
  memory?: { readonly origin: string; readonly action: DependencyKeyAction; readonly last: string },
): { readonly focus: string; readonly origin: string } | undefined {
  if (focusedId === null) return undefined;
  const links = dependencyLinks(dependencies);
  const continuing = memory !== undefined && memory.action === action && memory.last === focusedId;
  const origin = continuing ? memory.origin : focusedId;
  const list =
    action === "predecessor"
      ? (links.predecessors.get(origin) ?? []).map((dependency) => dependency.from)
      : (links.successors.get(origin) ?? []).map((dependency) => dependency.to);
  if (list.length === 0) return undefined;
  const at = continuing ? list.indexOf(focusedId) : -1;
  const focus = list[(at + 1) % list.length] as string;
  return { focus, origin };
}

// --- the task grid -----------------------------------------------------------

/** One row of the task grid: one lane, where it is across. */
export interface TaskGridRow<T = unknown> {
  readonly lane: LayoutLane;
  /** Position among all rows, from 1 — `aria-rowindex` (the header row is 1, so rows start at 2). */
  readonly index: number;
  /** Where the row starts across, in the view's pixels. */
  readonly cross: number;
  readonly crossSize: number;
  /** The lane's items, in layout order. */
  readonly items: readonly LayoutItem<T>[];
}

/** The rows of the task grid, and how many there are. */
export interface TaskGridWindow<T = unknown> {
  /** Every row's lane, for `aria-rowcount` and for the keyboard. */
  readonly total: number;
  /** The rows in view, plus the overscan. */
  readonly rows: readonly TaskGridRow<T>[];
}

/** Where the grid's rows are measured from. */
export interface TaskGridRowsOptions {
  /** The axis band, which the grid's header row lines up with. */
  readonly crossInset: number;
  /** How far the lanes are scrolled across. */
  readonly crossOffset: number;
  /** The view's size across. */
  readonly crossSize: number;
  /** Rows kept beyond each edge of the view. 4 by default. */
  readonly overscan?: number;
  /** Lanes to leave out — a group's header rows, drawn by the group tree. */
  readonly skip?: (lane: LayoutLane) => boolean;
}

const laneItemCache = new WeakMap<Layout, Map<string, LayoutItem[]>>();

function itemsByLane<T>(layout: Layout<T>): Map<string, LayoutItem<T>[]> {
  let byLane = laneItemCache.get(layout as Layout);
  if (byLane === undefined) {
    byLane = new Map();
    for (const placed of layout.items) {
      const list = byLane.get(placed.laneId);
      if (list === undefined) byLane.set(placed.laneId, [placed as LayoutItem]);
      else list.push(placed as LayoutItem);
    }
    laneItemCache.set(layout as Layout, byLane);
  }
  return byLane as Map<string, LayoutItem<T>[]>;
}

/**
 * The rows the grid draws: one per lane, at the lane's place across after
 * the scroll — exactly where the drawing has it, so a row and its lane are
 * on one line whatever was scrolled or collapsed — and only those in view
 * and the overscan. The lanes are sorted across, so the window is found by
 * bisection: a grid of 10 000 rows touches the rows it shows.
 */
export function taskGridRows<T>(layout: Layout<T>, options: TaskGridRowsOptions): TaskGridWindow<T> {
  const lanes = options.skip === undefined ? layout.lanes : layout.lanes.filter((lane) => !options.skip?.(lane));
  const total = lanes.length;
  const top = options.crossOffset;
  const bottom = options.crossOffset + options.crossSize - options.crossInset;
  // First lane whose far edge is past the top.
  let low = 0;
  let high = total;
  while (low < high) {
    const mid = (low + high) >> 1;
    const lane = lanes[mid] as LayoutLane;
    if (lane.cross + lane.crossSize <= top) low = mid + 1;
    else high = mid;
  }
  const overscan = options.overscan ?? 4;
  const first = Math.max(0, low - overscan);
  const byLane = itemsByLane(layout);
  const rows: TaskGridRow<T>[] = [];
  let past = 0;
  for (let at = first; at < total; at += 1) {
    const lane = lanes[at] as LayoutLane;
    if (lane.cross >= bottom) {
      past += 1;
      if (past > overscan) break;
    }
    rows.push({
      lane,
      index: at + 2,
      cross: lane.cross + options.crossInset - options.crossOffset,
      crossSize: lane.crossSize,
      items: byLane.get(lane.lane.id) ?? [],
    });
  }
  return { total, rows };
}

/** What a key does in the task grid. */
export type GridKeyAction = "next" | "previous" | "first" | "last" | "pageDown" | "pageUp" | "open";

/** The grid's keys: the rows run across the time axis, so in a vertical timeline left and right walk them. */
export function resolveGridKey(sample: KeySample, orientation: Orientation): GridKeyAction | undefined {
  if (sample.ctrlKey || sample.metaKey || sample.altKey) return undefined;
  const horizontal = orientation === "horizontal";
  switch (sample.key) {
    case horizontal ? "ArrowDown" : "ArrowRight":
      return "next";
    case horizontal ? "ArrowUp" : "ArrowLeft":
      return "previous";
    case "Home":
      return "first";
    case "End":
      return "last";
    case "PageDown":
      return "pageDown";
    case "PageUp":
      return "pageUp";
    case "Enter":
    case " ":
      return "open";
    default:
      return undefined;
  }
}

/**
 * The row a grid key moves to, as a position among all rows from 0, or
 * `undefined` for `open` (the host opens the focused row) and for a key
 * with nowhere to go.
 */
export function gridKeyStep(total: number, focused: number, action: GridKeyAction, pageRows = 10): number | undefined {
  if (total === 0 || action === "open") return undefined;
  const at = Math.min(Math.max(focused, 0), total - 1);
  const next =
    action === "next"
      ? at + 1
      : action === "previous"
        ? at - 1
        : action === "first"
          ? 0
          : action === "last"
            ? total - 1
            : action === "pageDown"
              ? at + pageRows
              : at - pageRows;
  const clamped = Math.min(Math.max(next, 0), total - 1);
  return clamped === at ? undefined : clamped;
}

/**
 * How far across the lanes have to scroll to show a lane whole: `offset`
 * unchanged when it is already in view.
 */
export function revealOffset(lane: { readonly cross: number; readonly crossSize: number }, offset: number, viewCrossSize: number, crossInset: number): number {
  const room = viewCrossSize - crossInset;
  if (lane.cross < offset) return lane.cross;
  if (lane.cross + lane.crossSize > offset + room) return Math.max(0, lane.cross + lane.crossSize - room);
  return offset;
}
