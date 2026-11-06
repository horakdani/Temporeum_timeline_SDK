/**
 * The renderer: items, axis, labels and decorations into one scene.
 *
 * This is the composer, and it owns three things nothing else can:
 *
 * **Culling.** Only items whose span intersects the visible domain produce
 * nodes. A host with a decade of data and an hour on screen pays for the hour.
 *
 * **Clipping, with an honest minimum.** An item is drawn no further than just
 * past the viewport edge, and never thinner than {@link DensityMetrics.minItemMainSize} —
 * a millisecond event at year zoom is a visible sliver instead of a zero-width
 * rectangle nobody can click. Labels are clipped to the *visible* part of an
 * item, so the text of something that starts off-screen stays readable.
 *
 * **Hooks, over the same geometry.** `renderItem`, `renderLabel` and
 * `renderDetail` get the finished geometry and may return their own node, or
 * `null` to draw nothing. The defaults are exported, so a hook that only wants
 * one more attribute wraps {@link defaultItemNode} instead of reimplementing
 * placement — the usual reason a library's custom renderers look worse than
 * its built-in ones.
 *
 * No colour appears here. Items carry classes; the stylesheet resolves them.
 * That is what makes a theme a CSS concern and dark mode free.
 *
 * **Semantics, by default.** An interactive frame is a `listbox` of `option`s:
 * every item has an id, a name with its date range, `aria-selected` and its
 * position among *all* items — culling keeps only the visible ones in the
 * document, and a reader must still hear "3 of 10 000". The root is the one
 * focus stop and points `aria-activedescendant` at the keyboard's item; the
 * layers that repeat what the items say (labels, axis, lanes) are hidden from
 * assistive technology, so nothing is read twice.
 */

import { clusterDomId, describeCluster, describeItem, itemDomId } from "./a11y.js";
import { clusterBox, clusterExtent, clusterLayout } from "./cluster.js";
import type { Cluster, ClusterMarker, ClusterOptions, Clustering } from "./cluster.js";
import { DEFAULT_TIME_ZONE, toCalendarParts } from "./calendar.js";
import type { LoadingRange } from "./data.js";
import type { Decoration, DecorationContext } from "./decorations.js";
import { decorationLayer, renderDecoration } from "./decorations.js";
import type { DensityMetrics, MetricsProvider } from "./density.js";
import { densityMetrics } from "./density.js";
import { htmlTextNode, rectAttrs, textNode, withClass } from "./draw.js";
import type { Projector, ScreenRect } from "./geometry.js";
import { containerExtents, createProjector } from "./geometry.js";
import type { LabelCandidate, LabelLayout, LabelOverflow, MeasureText, PlacedLabel } from "./labels.js";
import { createNavigator } from "./keyboard.js";
import { estimateTextWidth, labelSpace, placeLabels, search } from "./labels.js";
import type { Layout, LayoutItem } from "./layout.js";
import { itemRect, layoutItems } from "./layout.js";
import type { SceneElement } from "./scene.js";
import { formatNumber } from "./scene.js";
import type { TimeScale, TimeWarp } from "./scale.js";
import { createTimeScale } from "./scale.js";
import type { Theme, ThemeSetting, TouchActionMode } from "./theme.js";
import { resolveTheme, timelineStyleCss } from "./theme.js";
import { toTimeMs } from "./time.js";
import type { SceneSpace } from "./scene-space.js";
import type { Tick, TickOptions } from "./ticks.js";
import { generateTicks } from "./ticks.js";
import type {
  Density,
  Domain,
  Item,
  Lane,
  MainCross,
  MainCrossRect,
  Orientation,
  PackMode,
  TimeInput,
  Viewport,
} from "./types.js";

function pad(value: number, width: number): string {
  const text = String(Math.abs(value)).padStart(width, "0");
  return value < 0 ? `-${text}` : text;
}

/**
 * The built-in tick label: deterministic and locale-free.
 *
 * Deliberately not `Intl`. A default that formats through the platform's
 * locale data makes the same frame render differently on two machines, which
 * breaks server/client parity and makes a visual fixture a liability.
 * Localised axes are one `formatTick` away, and the recipe is in the docs.
 */
export function defaultTickLabel(tick: Tick, timeZone: string = DEFAULT_TIME_ZONE): string {
  const parts = toCalendarParts(tick.time, timeZone);
  if (tick.context === true) {
    // The coarser unit the view is in: what the ticks' own labels leave out.
    const date = `${pad(parts.year, 4)}-${pad(parts.month, 2)}`;
    switch (tick.granularity) {
      case "millisecond":
        return `${pad(parts.hour, 2)}:${pad(parts.minute, 2)}:${pad(parts.second, 2)}`;
      case "second":
        return `${date}-${pad(parts.day, 2)} ${pad(parts.hour, 2)}:${pad(parts.minute, 2)}`;
      case "minute":
      case "hour":
        return `${date}-${pad(parts.day, 2)}`;
      case "day":
        return date;
      case "month":
        return pad(parts.year, 4);
      default:
        // A year's label is already the whole date.
        return "";
    }
  }
  switch (tick.granularity) {
    case "millisecond":
      return tick.major
        ? `${pad(parts.second, 2)}.${pad(parts.millisecond, 3)}`
        : `.${pad(parts.millisecond, 3)}`;
    case "second":
      return tick.major
        ? `${pad(parts.hour, 2)}:${pad(parts.minute, 2)}:${pad(parts.second, 2)}`
        : `:${pad(parts.second, 2)}`;
    case "minute":
    case "hour":
      return tick.major && tick.granularity === "hour"
        ? `${pad(parts.month, 2)}-${pad(parts.day, 2)}`
        : `${pad(parts.hour, 2)}:${pad(parts.minute, 2)}`;
    case "day":
      return tick.major
        ? `${pad(parts.year, 4)}-${pad(parts.month, 2)}-${pad(parts.day, 2)}`
        : pad(parts.day, 2);
    case "month":
      return tick.major ? `${pad(parts.year, 4)}-${pad(parts.month, 2)}` : pad(parts.month, 2);
    default:
      return pad(parts.year, 4);
  }
}

/** What a render hook is handed for one item. */
export interface ItemRenderContext<T = unknown> {
  readonly placed: LayoutItem<T>;
  /** The box as drawn: clipped, and never thinner than the minimum. */
  readonly box: MainCrossRect;
  readonly rect: ScreenRect;
  readonly selected: boolean;
  /**
   * The accessible name: label, date range, lane. Also the default node's
   * `<title>`, so the native tooltip says when, not only what.
   */
  readonly name: string;
  readonly metrics: DensityMetrics;
  readonly projector: Projector;
  readonly scale: TimeScale;
}

/** What a render hook is handed for one label. */
export interface LabelRenderContext<T = unknown> {
  /** For a cluster's count, the cluster's first member. */
  readonly placed: LayoutItem<T>;
  /** Set when the label is a cluster's count. */
  readonly cluster?: Cluster<T>;
  readonly label: PlacedLabel;
  readonly metrics: DensityMetrics;
  readonly projector: Projector;
}

/** What a render hook is handed for one cluster marker. */
export interface ClusterRenderContext<T = unknown> {
  readonly cluster: Cluster<T>;
  /** The marker as drawn: the members' union, grown to fit the count where there is room. */
  readonly box: MainCrossRect;
  readonly rect: ScreenRect;
  /** Some member is selected. */
  readonly selected: boolean;
  /** The accessible name: "23 items, date range, lane". Also the `<title>`. */
  readonly name: string;
  readonly metrics: DensityMetrics;
  readonly projector: Projector;
  readonly scale: TimeScale;
}

/** Replace any of the default renderers. `null` draws nothing. */
export interface RenderHooks<T = unknown> {
  readonly renderItem?: (context: ItemRenderContext<T>) => SceneElement | null;
  /**
   * Draws a cluster marker. Its count is a label, drawn by `renderLabel`
   * like any other — with `placed` the cluster's first member.
   */
  readonly renderCluster?: (context: ClusterRenderContext<T>) => SceneElement | null;
  readonly renderLabel?: (context: LabelRenderContext<T>) => SceneElement | null;
  /** Called for each selected item. Nothing is drawn unless this is given. */
  readonly renderDetail?: (context: ItemRenderContext<T>) => SceneElement | null;
  /**
   * The accessible name of an item, replacing "label, date range, lane".
   * For a host whose items mean more than their label says.
   */
  readonly describeItem?: (placed: LayoutItem<T>) => string;
  /** The accessible name of a cluster, replacing "23 items, date range, lane". */
  readonly describeCluster?: (cluster: Cluster<T>) => string;
}

/** The default item node: a rounded rect with an accessible name. */
export function defaultItemNode<T>(context: ItemRenderContext<T>): SceneElement {
  const item = context.placed.item;
  const classes = ["tl-item"];
  if (context.placed.span.open) {
    classes.push("tl-item--open");
  }
  if (context.box.mainSize <= context.metrics.minItemMainSize) {
    classes.push("tl-item--instant");
  }
  if (context.selected) {
    classes.push("tl-item--selected");
  }
  return {
    tag: "rect",
    attrs: {
      class: withClass(classes.join(" "), item.className),
      "data-tl-id": item.id,
      ...rectAttrs(context.box, context.projector),
      rx: context.metrics.cornerRadius,
    },
    // A `<title>` is the one accessible name an SVG shape gets for free, and
    // it doubles as the native tooltip. The full text survives even when the
    // visible label was dropped for want of room. It is the same string as
    // the `aria-label`, so a reader that sees both does not hear it twice.
    children: [{ tag: "title", text: context.name }],
  };
}

/** The default cluster marker: a rounded rect, with the count as its label. */
export function defaultClusterNode<T>(context: ClusterRenderContext<T>): SceneElement {
  return {
    tag: "rect",
    attrs: {
      class: context.selected ? "tl-cluster tl-cluster--selected" : "tl-cluster",
      "data-tl-cluster": context.cluster.id,
      "data-tl-count": context.cluster.members.length,
      ...rectAttrs(context.box, context.projector),
      rx: Math.min(context.metrics.cornerRadius * 2, context.box.crossSize / 2),
    },
    children: [{ tag: "title", text: context.name }],
  };
}

/** The default label node: one line of text, never rotated. */
export function defaultLabelNode<T>(context: LabelRenderContext<T>): SceneElement {
  const label = context.label;
  const className =
    (label.placement === "after" ? "tl-label tl-label--after" : "tl-label") +
    (context.cluster === undefined ? "" : " tl-cluster-count");
  // `data-tl-label` names the item, so a label that stays keeps its node
  // when others come and go — whatever its text, which a dense frame
  // shortens to the same few letters for hundreds of items.
  return htmlTextNode(label.box, label.text, context.projector, { class: className, "data-tl-label": label.id });
}

/** Everything one frame is rendered from. */
export interface RenderOptions<T = unknown> {
  readonly items: readonly Item<T>[];
  readonly lanes?: readonly Lane[];
  readonly domain: readonly [TimeInput, TimeInput];
  /** Container width in CSS pixels. */
  readonly width: number;
  /** Container height in CSS pixels. */
  readonly height: number;
  readonly orientation?: Orientation;
  readonly density?: Density;
  /**
   * The sizes the frame draws, packs and measures with, by level:
   * `densityMetrics` by default. A row's height, the type, the corners and
   * the font are configuration, not CSS, because the layout is measured
   * with them.
   */
  readonly metrics?: MetricsProvider;
  readonly theme?: ThemeSetting;
  readonly packMode?: PackMode;
  readonly timeZone?: string;
  readonly decorations?: readonly Decoration[];
  readonly selectedIds?: readonly string[];
  /** Real text measurement from the host, if it has one. */
  readonly measureText?: MeasureText;
  readonly formatTick?: (tick: Tick, timeZone: string) => string;
  /**
   * The context label at the start of the axis: the month of a view of days,
   * the year of a view of months — `formatTick` with a tick whose `context`
   * is set, so a host's labels are its words here too. On by default; `false`
   * leaves the axis to its ticks.
   */
  readonly axisContext?: boolean;
  /**
   * The axis's ticks, replacing `generateTicks` — `generateTicks`'s contract.
   * For a calendar of its own: `calendarTicks` in `/intl`. A `hiddenDates`
   * warp's own ticks come after this.
   */
  readonly ticks?: (domain: Domain, mainSize: number, options: TickOptions) => readonly Tick[];
  /** Ceiling on drawn item labels. */
  readonly maxLabels?: number;
  /**
   * A label longer than its room: shortened with an ellipsis (`"ellipsis"`),
   * given up (`"drop"`), or `"auto"`, the default — shortened where a
   * viewport's width holds at most {@link SHORTEN_DENSITY_LIMIT} items, given
   * up where it holds more. Either way the full text stays the item's
   * accessible name and its `<title>`.
   */
  readonly labelOverflow?: LabelOverflow;
  /** Embed the default stylesheet. On by default; off for a host with its own. */
  readonly includeStyle?: boolean;
  /**
   * Whether the widget claims every touch gesture or shares one axis with the
   * page. Only reaches the stylesheet, but it is a rendering decision: it is
   * the difference between a widget that owns the screen and one embedded in
   * a page of text.
   */
  readonly touchAction?: TouchActionMode;
  /**
   * Scope the embedded stylesheet to this instance.
   *
   * Needed when a document holds more than one timeline: without it both
   * share the `.tl` rules and the one rendered last decides the theme and the
   * type sizes for both.
   */
  readonly instanceId?: string;

  readonly ariaLabel?: string;
  /**
   * The keyboard's item: drawn with a focus ring, and named by the root's
   * `aria-activedescendant`. The input machine's `focusedId`.
   */
  readonly focusedId?: string | null;
  /** Locale the accessible names' dates are written in. `en` by default. */
  readonly locale?: string;
  /** Several items can be selected at once: `aria-multiselectable`. */
  readonly multiSelect?: boolean;
  /**
   * `listbox` semantics and a focus stop. On by default; off for a frame that
   * is only ever an image — an export, a thumbnail — where a focus stop that
   * does nothing would be a trap for the keyboard.
   */
  readonly interactive?: boolean;
  readonly hooks?: RenderHooks<T>;
  /**
   * Time the view needs and does not have yet — an item loader's `loading`.
   * Drawn as a mark along the inner edge of the axis band (moving dashes
   * while loading, still dots where the request failed), and while any of it
   * is loading inside the view the root says `aria-busy`.
   */
  readonly loading?: readonly LoadingRange[];
  /**
   * How far the lanes are scrolled across, in CSS pixels — the input
   * machine's `crossOffset`. The axis band stays put; lanes and items move,
   * and whatever passes under the axis is clipped at its edge. The hit tester
   * takes the same number, so what is drawn and what is hit agree.
   */
  readonly crossOffset?: number;
  /**
   * Draw the item layer in this space instead of the viewport's. Item hooks
   * then receive boxes, a projector and a scale in the space, and the layer's
   * `transform` maps it onto the viewport. See {@link SceneSpace}.
   */
  readonly space?: SceneSpace;
  /**
   * Draw runs of items too small to tell apart as one marker with their
   * count. Off by default; `true` for the defaults, or the settings. See
   * `cluster.ts` for what joins a cluster, and {@link RenderResult.clusters}
   * for what to hand the hit tester.
   */
  readonly cluster?: boolean | ClusterOptions;
  /**
   * Time that is not drawn — nights, weekends, a shutdown — from
   * `createHiddenDates` in `/tools`. The axis runs in shown time: a hidden
   * stretch takes no room, an item across one is drawn without it, and its
   * ticks are left out. Frames with hidden dates are drawn exactly: a
   * {@link space} is ignored.
   */
  readonly hiddenDates?: TimeWarp;
  /**
   * The layout of `items`, when the host already has it — `relayout` in
   * `/tools` keeps one up to date across live changes, re-packing only the
   * lanes a change touched. It must be the layout these options would
   * compute: the same lanes, pack mode, zone and density metrics.
   */
  readonly layout?: Layout<T>;
}

/** The frame, and everything the host may want to know about it. */
export interface RenderResult<T = unknown> {
  readonly scene: SceneElement;
  readonly layout: Layout<T>;
  readonly ticks: readonly Tick[];
  readonly labels: LabelLayout;
  readonly viewport: Viewport;
  /** Cross extent the content needs. Above the container's, the host scrolls. */
  readonly contentCrossSize: number;

  /**
   * Items drawn: those within the viewport, plus the culling margin, along
   * both axes. A cluster counts as its members — so with clustering on this
   * is still a number of items, not of markers.
   */
  readonly visibleCount: number;
  /** The clusters at this zoom, when clustering is on: hand it to the keyboard's navigator. */
  readonly clustering?: Clustering<T>;
  /** The markers this frame drew, where it drew them: hand them to the hit tester. */
  readonly clusters: readonly ClusterMarker<T>[];
  /**
   * Tiles in view still stood in for by another scale's (a space with a
   * {@link SceneSpace.budget}). A host requests another frame while this is
   * above zero; 0 without a space. Off-screen stand-ins wait for the view
   * to reach them, or for the frame at rest, which draws everything.
   */
  readonly pendingTiles: number;
}

interface DrawnItem<T> {
  /** For a cluster, its first member. */
  readonly placed: LayoutItem<T>;
  /** Set when the entry is a cluster's marker rather than an item. */
  readonly cluster?: Cluster<T>;
  /** As drawn, in the space when there is one. */
  readonly box: MainCrossRect;
  /** The part of the item a label may use: the drawn part, in the same space. */
  readonly labelBox: MainCrossRect;
  readonly labelled: boolean;
  /** Where the item really starts and ends along the main axis, unclipped. */
  readonly rawMain: number;
  readonly rawEnd: number;
}

/** The layer order, named once: the empty frame has to match the real one. */
const LAYER_NAMES = [
  "background",
  "axis",
  "lanes",
  "items",
  "labels",
  "foreground",
  "overlay",
  "context",
] as const;

function layer(
  name: string,
  children: readonly SceneElement[],
  transform?: string,
  interactive = false,
): SceneElement {
  // Layers are emitted even when empty: a stable node structure is what lets
  // a patching mount diff frames instead of rebuilding them. In an
  // interactive frame only the items speak: the item layer is a plain
  // container, and every other layer repeats or decorates what they say.
  const semantics = interactive ? (name === "items" ? { role: "none" } : { "aria-hidden": "true" }) : {};
  return { tag: "g", attrs: { class: `tl-layer tl-layer--${name}`, transform, ...semantics }, children };
}

/**
 * The root's own attributes.
 *
 * An interactive frame with something to choose from is a `listbox`. One
 * with nothing drawn — no data yet, a failed window, a pan into an empty
 * stretch — is a `group` with the same name and the same focus stop: a
 * listbox without an option is not a list anyone can choose from, and axe
 * cannot decide it either (`aria-required-children`). Keeping the focus
 * stop matters more than the role: the keyboard still pans and zooms from
 * there, and a frame that dropped its `tabindex` would drop the focus with it.
 */
function rootSemantics<T>(
  options: RenderOptions<T>,
  orientation: Orientation,
  active: string | undefined,
  hasOptions: boolean,
): Record<string, string | number | undefined> {
  if (options.interactive === false) {
    return { role: "group", "aria-label": options.ariaLabel ?? "Timeline" };
  }
  if (!hasOptions) {
    return { role: "group", tabindex: 0, "aria-label": options.ariaLabel ?? "Timeline" };
  }
  return {
    role: "listbox",
    tabindex: 0,
    "aria-label": options.ariaLabel ?? "Timeline",
    "aria-orientation": orientation,
    "aria-multiselectable": options.multiSelect === true ? "true" : undefined,
    "aria-activedescendant": active,
  };
}

/** Whether a layer's nodes hold an option — directly, or inside a tile group. */
function holdsOption(nodes: readonly SceneElement[]): boolean {
  return nodes.some(
    (node) => node.attrs?.role === "option" || (node.children ?? []).some((child) => child.attrs?.role === "option"),
  );
}

/** What an interactive frame tells assistive technology about each item. */
interface ItemSemantics<T> {
  readonly prefix: string;
  readonly locale: string;
  readonly timeZone: string;
  readonly setSize: number;
  position(id: string): number;
  readonly laneLabels: ReadonlyMap<string, string | undefined>;
  readonly describe: ((placed: LayoutItem<T>) => string) | undefined;
  readonly describeCluster: ((cluster: Cluster<T>) => string) | undefined;
}

function semanticsOf<T>(
  options: RenderOptions<T>,
  layout: Layout<T>,
  timeZone: string,
  clustering: Clustering<T> | undefined,
): ItemSemantics<T> | undefined {
  if (options.interactive === false) {
    return undefined;
  }
  // With clustering the listbox lists what is drawn: a cluster is one option.
  const navigator = createNavigator(layout, clustering === undefined ? {} : { clustering });
  return {
    prefix: options.instanceId ?? "tl",
    locale: options.locale ?? "en",
    timeZone,
    setSize: navigator.entries.length,
    position: (id) => navigator.indexOf(id) + 1,
    laneLabels: new Map(layout.lanes.map((lane) => [lane.lane.id, lane.lane.label])),
    describe: options.hooks?.describeItem,
    describeCluster: options.hooks?.describeCluster,
  };
}

function nameOf<T>(placed: LayoutItem<T>, semantics: ItemSemantics<T> | undefined): string {
  if (semantics === undefined) {
    return placed.item.label ?? placed.item.id;
  }
  return semantics.describe !== undefined
    ? semantics.describe(placed)
    : describeItem(placed.item, placed.span, semantics.laneLabels.get(placed.laneId), semantics.locale, semantics.timeZone);
}

function clusterNameOf<T>(cluster: Cluster<T>, semantics: ItemSemantics<T> | undefined, timeZone: string): string {
  if (semantics?.describeCluster !== undefined) {
    return semantics.describeCluster(cluster);
  }
  return describeCluster(
    cluster.members.length,
    cluster.start,
    cluster.lastStart,
    semantics?.laneLabels.get(cluster.laneId),
    semantics?.locale ?? "en",
    timeZone,
  );
}

/**
 * Decimals of the item layer's scale.
 *
 * The scale multiplies coordinates in the thousands, so the three decimals
 * every other attribute gets would put an item a pixel off at the far edge.
 * Nine keep the error below a thousandth of a pixel at a million.
 */
const STRETCH_DECIMALS = 9;

/** Pixels between an item and its focus ring: clear of the selection stroke. */
const FOCUS_RING_GAP = 3;

/** Width of the loading mark, across the axis. */
const LOADING_MARK = 3;

/** Whether anything is still loading inside the domain. A failure is not "busy". */
function busyIn(loading: readonly LoadingRange[] | undefined, domain: readonly [number, number]): boolean {
  return (loading ?? []).some((range) => range.failed !== true && range.start < domain[1] && range.end > domain[0]);
}

/**
 * The loading marks: one line per range, along the inner edge of the axis
 * band, clipped to `[from, to]` of the main axis in `scale`'s space.
 *
 * Drawn per frame, outside every cache — what is loading changes while the
 * items do not — and in the overlay, which is hidden from assistive
 * technology: `aria-busy` on the root is what a reader is told.
 */
function loadingMarks(
  loading: readonly LoadingRange[],
  scale: TimeScale,
  from: number,
  to: number,
  metrics: DensityMetrics,
  projector: Projector,
): SceneElement[] {
  const cross = metrics.axisSize - LOADING_MARK / 2;
  const marks: SceneElement[] = [];
  for (const range of loading) {
    const start = Math.max(scale.toMain(range.start), from);
    const end = Math.min(scale.toMain(range.end), to);
    if (!(end > start)) {
      continue;
    }
    const a = projector.projectPoint({ main: start, cross });
    const b = projector.projectPoint({ main: end, cross });
    marks.push({
      tag: "line",
      attrs: {
        class: range.failed === true ? "tl-loading tl-loading--failed" : "tl-loading",
        x1: a.x,
        y1: a.y,
        x2: b.x,
        y2: b.y,
      },
    });
  }
  return marks;
}

interface EmptyFrameContext {
  readonly orientation: Orientation;
  readonly density: Density;
  readonly metrics: DensityMetrics;
  readonly mainSize: number;
  readonly crossSize: number;
  readonly domain: readonly [number, number];
  readonly theme: Theme | undefined;
}

/** The frame's stylesheet, unless the host brings its own (`includeStyle: false`). */
function styleNode<T>(options: RenderOptions<T>, orientation: Orientation, metrics: DensityMetrics): SceneElement | undefined {
  return options.includeStyle === false
    ? undefined
    : {
        tag: "style",
        text: timelineStyleCss({
          ...(options.theme === undefined ? {} : { theme: options.theme }),
          ...(options.instanceId === undefined ? {} : { scope: options.instanceId }),
          ...(options.touchAction === undefined ? {} : { touchAction: options.touchAction }),
          orientation,
          metrics,
        }),
      };
}

/**
 * The frame for a container with no pixels.
 *
 * Same root element, same layers, no content: a patching renderer diffs it
 * against a real frame without rebuilding, and a host that mounts it gets the
 * stylesheet and the data attributes already in place.
 */
function emptyFrame<T>(
  options: RenderOptions<T>,
  context: EmptyFrameContext,
): RenderResult<T> {
  const children: SceneElement[] = [];
  const style = styleNode(options, context.orientation, context.metrics);
  if (style !== undefined) {
    children.push(style);
  }
  for (const name of LAYER_NAMES) {
    children.push(layer(name, [], undefined, options.interactive !== false));
  }
  return {
    scene: {
      tag: "svg",
      attrs: {
        xmlns: "http://www.w3.org/2000/svg",
        class: "tl",
        viewBox: `0 0 ${String(Math.max(options.width, 0))} ${String(Math.max(options.height, 0))}`,
        width: Math.max(options.width, 0),
        height: Math.max(options.height, 0),
        "data-tl-orientation": context.orientation,
        "data-tl-density": context.density,
        "data-tl-theme": context.theme?.name,
        "data-tl-instance": options.instanceId,
        ...rootSemantics(options, context.orientation, undefined, false),
        "aria-busy": busyIn(options.loading, context.domain) ? "true" : undefined,
      },
      children,
    },
    layout: layoutItems<T>([], {
      metrics: {
        rowSize: context.metrics.rowSize,
        rowGap: context.metrics.rowGap,
        laneGap: context.metrics.laneGap,
      },
    }),
    ticks: [],
    labels: { kept: [], dropped: [] },
    viewport: {
      domain: context.domain,
      orientation: context.orientation,
      density: context.density,
      mainSize: Math.max(context.mainSize, 0),
      crossSize: Math.max(context.crossSize, 0),
      // No pixels, no scale. `mainSize === 0` is the signal to check, and a
      // zero here keeps a host's arithmetic finite instead of spreading NaN.
      msPerPx: 0,
    },
    contentCrossSize: 0,
    visibleCount: 0,
    clusters: [],
    pendingTiles: 0,
  };
}

interface LayoutCacheEntry {
  /** The references the layout was computed from, element by element. */
  readonly snapshot: readonly unknown[];
  readonly laneSnapshot: readonly Lane[] | undefined;
  readonly key: string;
  readonly layout: Layout<unknown>;
}

/**
 * The last layout computed for each items array.
 *
 * Packing is done in time, not in pixels, so a pan or a zoom leaves the layout
 * exactly as it was — and at 10 000 items it is over 90% of a frame (31 of
 * 33 ms, measured in Chromium). Recomputing it on every frame of a gesture is
 * the single largest waste the renderer had.
 *
 * Keyed by the array, so two timelines on one page do not evict each other,
 * and checked against a reference snapshot of its elements, so a host that
 * pushes into or replaces an element of the *same* array still gets a fresh
 * layout: a cache that is only right for hosts that never mutate is a bug
 * report waiting for a plain-JavaScript user. The check is one pointer
 * comparison per item — microseconds, against tens of milliseconds saved.
 *
 * What it cannot see is a field written into an item object in place. Items
 * are `readonly` in the types for exactly that reason, and the README says so.
 */
const layoutCache = new WeakMap<readonly unknown[], LayoutCacheEntry>();

function sameReferences(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) {
      return false;
    }
  }
  return true;
}

function sameLanes(a: readonly Lane[] | undefined, b: readonly Lane[] | undefined): boolean {
  return a === undefined || b === undefined ? a === b : sameReferences(a, b);
}

function cachedLayout<T>(
  items: readonly Item<T>[],
  lanes: readonly Lane[] | undefined,
  packMode: PackMode | undefined,
  timeZone: string,
  metrics: DensityMetrics,
): Layout<T> {
  const key = `${packMode ?? ""}|${timeZone}|${String(metrics.rowSize)}|${String(metrics.rowGap)}|${String(metrics.laneGap)}`;
  const entry = layoutCache.get(items);
  if (
    entry !== undefined &&
    entry.key === key &&
    sameLanes(entry.laneSnapshot, lanes) &&
    sameReferences(entry.snapshot, items)
  ) {
    return entry.layout as Layout<T>;
  }
  const layout = layoutItems(items, {
    ...(lanes === undefined ? {} : { lanes }),
    ...(packMode === undefined ? {} : { packMode }),
    timeZone,
    metrics: { rowSize: metrics.rowSize, rowGap: metrics.rowGap, laneGap: metrics.laneGap },
  });
  layoutCache.set(items, {
    snapshot: [...items],
    laneSnapshot: lanes === undefined ? undefined : [...lanes],
    key,
    layout,
  });
  return layout;
}

/** What a frame draws, before it is placed: everything but the transforms. */
interface FrameContent<T> {
  readonly style: SceneElement | undefined;
  readonly background: readonly SceneElement[];
  readonly axis: readonly SceneElement[];
  readonly lanes: readonly SceneElement[];
  readonly items: readonly SceneElement[];
  readonly labelNodes: readonly SceneElement[];
  readonly foreground: readonly SceneElement[];
  readonly details: readonly SceneElement[];
  readonly ticks: readonly Tick[];
  readonly labels: LabelLayout;
  readonly drawn: readonly DrawnItem<T>[];
}

/** What every part of a frame is drawn with. */
interface DrawContext<T> {
  readonly orientation: Orientation;
  readonly metrics: DensityMetrics;
  readonly projector: Projector;
  readonly mainSize: number;
  readonly crossSize: number;
  /** Where items and labels are drawn: the space, or the viewport. */
  readonly itemScale: TimeScale;
  readonly layout: Layout<T>;
  readonly scroll: number;
  readonly timeZone: string;
  readonly semantics: ItemSemantics<T> | undefined;
  /** The clusters at the item scale's zoom, when clustering is on. */
  readonly clustering: Clustering<T> | undefined;
}

/**
 * Where a cluster's marker sits along the main axis, unclipped, in the item
 * scale — or `undefined` for a member that is not the cluster's first: the
 * marker stands for it, and is drawn once.
 *
 * `reach` is what culling decides by: the union of the members' boxes, not
 * the marker grown to fit its count — so a marker is drawn exactly when one
 * of its members would have been, and a count never reaches into view on
 * its own. An item that is not clustered is its own box, and the loops take
 * it straight from `itemRect`: the path without clustering allocates nothing
 * a frame did not allocate before.
 */
function clusterUnitOf<T>(
  placed: LayoutItem<T>,
  cluster: Cluster<T>,
  context: DrawContext<T>,
  measure: (text: string) => MainCross,
): { readonly raw: MainCrossRect; readonly reach: { readonly main: number; readonly mainSize: number }; readonly cluster: Cluster<T> } | undefined {
  if (cluster.members[0] !== placed) {
    return undefined;
  }
  const minItemMainSize = context.metrics.minItemMainSize;
  const box = clusterBox(cluster, context.itemScale, minItemMainSize, measure(String(cluster.members.length)).main);
  return {
    raw: { ...box, cross: cluster.cross, crossSize: cluster.crossSize },
    reach: clusterExtent(cluster, context.itemScale, minItemMainSize),
    cluster,
  };
}

/**
 * Where an item sits across, after the lane scroll — or `undefined` when it
 * is culled across. The near edge is the axis band, and nothing is drawn
 * under it; the far edge has the margin.
 */
function crossBoxOf(
  raw: Pick<MainCrossRect, "cross" | "crossSize">,
  metrics: DensityMetrics,
  scroll: number,
  crossSize: number,
): { readonly cross: number; readonly crossSize: number } | undefined {
  const crossInset = metrics.axisSize;
  const cross = raw.cross + crossInset - scroll;
  const crossEnd = cross + raw.crossSize;
  if (crossEnd <= crossInset || cross >= crossSize + metrics.rowSize) {
    return undefined;
  }
  const clipped = Math.max(cross, crossInset);
  return { cross: clipped, crossSize: crossEnd - clipped };
}

/** The item, label and detail nodes for what was drawn and placed. */
function itemNodesOf<T>(
  options: RenderOptions<T>,
  context: DrawContext<T>,
  drawn: readonly DrawnItem<T>[],
  kept: readonly PlacedLabel[],
  selected: ReadonlySet<string>,
): { items: SceneElement[]; labels: SceneElement[]; details: SceneElement[] } {
  const { metrics, projector, itemScale } = context;
  const hooks = options.hooks ?? {};
  const items: SceneElement[] = [];
  const details: SceneElement[] = [];
  const byId = new Map<string, DrawnItem<T>>();
  const semantics = context.semantics;
  for (const entry of drawn) {
    const id = entry.placed.item.id;
    byId.set(id, entry);
    if (entry.cluster !== undefined) {
      const node = clusterNodeOf(options, context, entry.cluster, entry.box, selected);
      if (node !== null) {
        items.push(node);
      }
      continue;
    }
    const itemContext: ItemRenderContext<T> = {
      placed: entry.placed,
      box: entry.box,
      rect: projector.projectRect(entry.box),
      selected: selected.has(id),
      name: nameOf(entry.placed, semantics),
      metrics,
      projector,
      scale: itemScale,
    };
    const node =
      hooks.renderItem === undefined ? defaultItemNode(itemContext) : hooks.renderItem(itemContext);
    if (node !== null) {
      // Added after the hook, so an item drawn by the host is an option too;
      // whatever the hook set itself wins.
      items.push(
        semantics === undefined
          ? node
          : {
              ...node,
              attrs: {
                id: itemDomId(semantics.prefix, id),
                role: "option",
                "aria-label": itemContext.name,
                "aria-selected": String(itemContext.selected),
                "aria-posinset": semantics.position(id),
                "aria-setsize": semantics.setSize,
                ...node.attrs,
              },
            },
      );
    }
    if (itemContext.selected && hooks.renderDetail !== undefined) {
      const detail = hooks.renderDetail(itemContext);
      if (detail !== null) {
        details.push(detail);
      }
    }
  }
  const labels: SceneElement[] = [];
  for (const label of kept) {
    const entry = byId.get(label.id);
    if (entry === undefined) {
      continue;
    }
    const labelContext: LabelRenderContext<T> = {
      placed: entry.placed,
      ...(entry.cluster === undefined ? {} : { cluster: entry.cluster }),
      label,
      metrics,
      projector,
    };
    const node =
      hooks.renderLabel === undefined ? defaultLabelNode(labelContext) : hooks.renderLabel(labelContext);
    if (node !== null) {
      labels.push(node);
    }
  }
  return { items, labels, details };
}

/** A cluster's marker node, with its option semantics. */
function clusterNodeOf<T>(
  options: RenderOptions<T>,
  context: DrawContext<T>,
  cluster: Cluster<T>,
  box: MainCrossRect,
  selected: ReadonlySet<string>,
): SceneElement | null {
  const semantics = context.semantics;
  const clusterContext: ClusterRenderContext<T> = {
    cluster,
    box,
    rect: context.projector.projectRect(box),
    selected: cluster.members.some((member) => selected.has(member.item.id)),
    name: clusterNameOf(cluster, semantics, context.timeZone),
    metrics: context.metrics,
    projector: context.projector,
    scale: context.itemScale,
  };
  const hook = options.hooks?.renderCluster;
  const node = hook === undefined ? defaultClusterNode(clusterContext) : hook(clusterContext);
  if (node === null || semantics === undefined) {
    return node;
  }
  return {
    ...node,
    attrs: {
      id: clusterDomId(semantics.prefix, cluster.id),
      role: "option",
      "aria-label": clusterContext.name,
      "aria-selected": String(clusterContext.selected),
      "aria-posinset": semantics.position(cluster.id),
      "aria-setsize": semantics.setSize,
      ...node.attrs,
    },
  };
}

/** Items and labels of a frame without a space: the viewport, exactly. */
function drawExactItems<T>(
  options: RenderOptions<T>,
  context: DrawContext<T>,
  domain: readonly [number, number],
): { drawn: DrawnItem<T>[]; labels: LabelLayout; items: SceneElement[]; labelNodes: SceneElement[]; details: SceneElement[] } {
  const drawn = exactEntries(context.layout.items, context, domain, options.measureText);
  const candidates = drawn.filter((entry) => entry.labelled).map((entry) => candidateOf(entry, true));
  const labels = placeLabels(candidates, {
    mainSize: context.mainSize,
    measure: labelSpace(context.metrics, options.measureText ?? estimateTextWidth),
    ...(options.maxLabels === undefined ? {} : { maxLabels: options.maxLabels }),
    ...overflowAt(options, candidates.length),
  });
  const nodes = itemNodesOf(options, context, drawn, labels.kept, new Set(options.selectedIds ?? []));
  return { drawn, labels, items: nodes.items, labelNodes: nodes.labels, details: nodes.details };
}

/**
 * What an exact frame draws of `placedItems`, in the viewport's pixels.
 *
 * One function for two callers, so they compute the same numbers to the
 * bit: the exact frame, over the whole layout, and a space's frame at rest,
 * over what it drew — which places its labels as the exact frame would
 * ({@link restLabels}). Label order breaks ties on width and position, and a
 * tie computed along two paths can differ in its last bit.
 */
function exactEntries<T>(
  placedItems: readonly LayoutItem<T>[],
  context: DrawContext<T>,
  domain: readonly [number, number],
  measureText: MeasureText | undefined,
): DrawnItem<T>[] {
  const { metrics, mainSize, crossSize, itemScale: scale, scroll, clustering } = context;
  // The culling margin, on both axes. Something just past an edge is drawn,
  // so its stroke, its rounded corner or its minimum width never pops in a
  // frame late; something further out costs nothing at all.
  const margin = metrics.rowSize;
  const overdraw = metrics.rowSize;
  const drawn: DrawnItem<T>[] = [];
  const measure = labelSpace(metrics, measureText ?? estimateTextWidth);
  for (const placed of placedItems) {
    // A cluster is culled as one unit: its marker spans every member, so it
    // is drawn exactly when any of them would have been.
    // Without clustering this is the item's own box: the
    // fast path allocates nothing a frame did not already allocate.
    const clustered = clustering?.clusterOf(placed.item.id);
    const unit = clustered === undefined ? undefined : clusterUnitOf(placed, clustered, context, measure);
    if (clustered !== undefined && unit === undefined) {
      continue;
    }
    const raw = unit?.raw ?? itemRect(placed, scale);
    const reach = unit?.reach ?? raw;
    const cluster = unit?.cluster;
    const rawEnd = raw.main + Math.max(raw.mainSize, metrics.minItemMainSize);
    if (reach.main + Math.max(reach.mainSize, metrics.minItemMainSize) <= -margin || reach.main >= mainSize + margin) {
      continue;
    }
    const crossBox = crossBoxOf(raw, metrics, scroll, crossSize);
    if (crossBox === undefined) {
      continue;
    }
    const start = Math.max(raw.main, -overdraw);
    // An open interval is clipped to the domain end by `itemRect`, which
    // would leave its rounded corner sitting exactly on the viewport edge
    // and read as an ending. Letting it run past the edge is what makes "no
    // known end" look like no known end.
    const end = Math.min(cluster === undefined && placed.span.open ? rawEnd + overdraw : rawEnd, mainSize + overdraw);
    const visibleStart = Math.max(raw.main, 0);
    const visibleEnd = Math.min(rawEnd, mainSize);
    const span = cluster ?? placed.span;
    drawn.push({
      placed,
      ...(cluster === undefined ? {} : { cluster }),
      box: { main: start, mainSize: Math.max(end - start, metrics.minItemMainSize), ...crossBox },
      // Only what is on screen gets a label. An item drawn because it is
      // inside the margin would otherwise have its label placed at the edge
      // of the viewport, next to nothing. Labels are clipped to the visible
      // part, so the text of something that starts off-screen stays readable.
      labelled: span.start < domain[1] && span.end > domain[0] && crossBox.cross < crossSize,
      labelBox: { main: visibleStart, mainSize: Math.max(visibleEnd - visibleStart, 0), ...crossBox },
      rawMain: raw.main,
      rawEnd,
    });
  }
  return drawn;
}

/** A drawn item as a label candidate — or, without its text, as room it takes. */
function candidateOf<T>(entry: DrawnItem<T>, withText: boolean): LabelCandidate {
  if (entry.cluster !== undefined) {
    // A count is placed before any other label: it is what the marker says.
    return {
      id: entry.cluster.id,
      text: withText ? String(entry.cluster.members.length) : "",
      box: entry.labelBox,
      row: entry.cluster.row,
      rowSpan: 1,
      priority: CLUSTER_LABEL_PRIORITY,
    };
  }
  return {
    id: entry.placed.item.id,
    text: withText ? (entry.placed.item.label ?? "") : "",
    box: entry.labelBox,
    row: entry.placed.row,
    rowSpan: entry.placed.sublaneSpan,
  };
}

/** Above any item's own priority, which is its width on screen. */
const CLUSTER_LABEL_PRIORITY = Number.MAX_SAFE_INTEGER;

/**
 * Items in a viewport's width past which `labelOverflow: "auto"` stops
 * shortening labels.
 *
 * Every label is a node the browser paints on every frame of a pan, like an
 * item. The budget is measured at two thousand items in view; at ten
 * thousand items, with a shortened label on each of the two thousand, a pan
 * missed a third of its frames in Chromium at a 4x slowdown, and with six
 * hundred of them still a fifth. Up to a thousand items, labels and
 * items together stay within the two thousand the budget holds. Past it,
 * only the labels that fit whole are drawn, as before 1.0.0-rc.5; drawing
 * more needs labels painted off the DOM.
 */
export const SHORTEN_DENSITY_LIMIT = 1000;

/** The overflow a placement uses, given how many items a viewport's width holds where it places. */
function overflowAt<T>(options: RenderOptions<T>, perViewport: number): { readonly overflow: LabelOverflow } {
  const setting = options.labelOverflow ?? "auto";
  return { overflow: setting === "auto" ? (perViewport > SHORTEN_DENSITY_LIMIT ? "drop" : "ellipsis") : setting };
}

/**
 * Axis, lanes, decorations and the stylesheet: everything but the items.
 *
 * Drawn from `frameScale`, which starts at 0: the viewport without a space,
 * the drawn range in one — and then the layers' transform places them.
 */
function drawFrame<T>(
  options: RenderOptions<T>,
  context: DrawContext<T>,
  frameScale: TimeScale,
): Pick<FrameContent<T>, "style" | "background" | "axis" | "lanes" | "foreground" | "ticks"> {
  const { orientation, metrics, projector, crossSize, layout, scroll, timeZone } = context;
  const measureTick = labelSpace(metrics, options.measureText ?? estimateTextWidth, metrics.tickFontSize);
  const formatTick = options.formatTick ?? defaultTickLabel;
  const frameSize = frameScale.mainSize;
  const ticks = (options.ticks ?? options.hiddenDates?.ticks ?? generateTicks)(frameScale.domain, frameSize, {
    timeZone,
    targetSpacingPx: metrics.tickSpacing,
  });

  // --- axis ---------------------------------------------------------------
  const axisNodes: SceneElement[] = [];
  // One claim list for the axis band, shared with the decorations below: tick
  // labels, the now label and marker labels all live there and must not be
  // drawn on top of each other.
  const axisClaimed: { readonly start: number; readonly end: number }[] = [];
  const claimLabelRoom = (start: number, end: number): boolean => {
    if (start < 0 || end > frameSize) {
      return false;
    }
    for (const taken of axisClaimed) {
      if (!(taken.end <= start || taken.start >= end)) {
        return false;
      }
    }
    axisClaimed.push({ start, end });
    return true;
  };
  for (const tick of ticks) {
    const main = frameScale.toMain(tick.time);
    axisNodes.push({
      tag: "line",
      attrs: {
        class: tick.major ? "tl-tick tl-tick--major" : "tl-tick",
        x1: projector.projectPoint({ main, cross: 0 }).x,
        y1: projector.projectPoint({ main, cross: 0 }).y,
        x2: projector.projectPoint({ main, cross: crossSize }).x,
        y2: projector.projectPoint({ main, cross: crossSize }).y,
      },
    });
    const text = formatTick(tick, timeZone);
    if (text === "") {
      continue;
    }
    const need = measureTick(text);
    // Tick labels are dropped on collision too. The step is chosen to give
    // them room, but a major label is longer than a minor one. The cross
    // check matters in a vertical timeline, where the label runs across the
    // axis band and a long one would otherwise reach into the first lane.
    if (need.cross > metrics.axisSize || !claimLabelRoom(main, main + need.main)) {
      continue;
    }
    axisNodes.push(
      textNode(
        { main, mainSize: need.main, cross: 0, crossSize: metrics.axisSize },
        text,
        projector,
        tick.major ? "tl-tick-label tl-tick-label--major" : "tl-tick-label",
        metrics.labelPadding,
      ),
    );
  }

  // --- lanes --------------------------------------------------------------
  const crossInset = metrics.axisSize;
  const laneNodes: SceneElement[] = [];
  for (const laid of layout.lanes) {
    const from = laid.cross + crossInset - scroll;
    const to = from + laid.crossSize;
    // Lanes are culled and clipped like items, and for the same reason: a
    // lane scrolled under the axis band would otherwise paint over it.
    if (to <= crossInset || from >= crossSize + metrics.rowSize) {
      continue;
    }
    const clipped = Math.max(from, crossInset);
    laneNodes.push({
      tag: "rect",
      attrs: {
        class: laid.pinned ? "tl-lane tl-lane--pinned" : "tl-lane",
        "data-tl-lane": laid.lane.id,
        ...rectAttrs(
          { main: 0, mainSize: frameSize, cross: clipped, crossSize: to - clipped },
          projector,
        ),
      },
    });
  }

  // --- decorations --------------------------------------------------------
  const decorationContext: DecorationContext = {
    scale: frameScale,
    projector,
    metrics,
    crossSize,
    ticks,
    timeZone,
    measure: measureTick,
    claimLabelRoom,
  };
  const background: SceneElement[] = [];
  const foreground: SceneElement[] = [];
  for (const decoration of options.decorations ?? []) {
    const nodes = renderDecoration(decoration, decorationContext);
    (decorationLayer(decoration) === "background" ? background : foreground).push(...nodes);
  }

  const style = styleNode(options, orientation, metrics);
  return { style, background, axis: axisNodes, lanes: laneNodes, foreground, ticks };
}

// --- tiles ------------------------------------------------------------------

/**
 * Tiles per viewport width.
 *
 * In a space the drawn range is cut into tiles along the main axis, and each
 * tile is drawn — items, labels, details — once, then handed back as the
 * same nodes until something it depends on changes. A pan that reaches past
 * what is drawn therefore pays for the tile that came in, not for the whole
 * range (90 ms of script per such frame at 4x for three viewports of
 * items, before tiles). A sixteenth of a viewport keeps that tile small —
 * it is the step a re-anchor refills in, two at a time, and the step
 * a frame at rest grows the overscan by. A frame that redraws more
 * than a fifth of 2000 items in view misses its vsync at a 4x slowdown, and
 * a frame at rest that brought in an eighth of a viewport of new items —
 * 300 of them, each with its title and its name — still missed it whenever
 * the machine was busy: half of that does not.
 */
const TILES_PER_VIEWPORT = 16;

/**
 * How far from the space's origin an item is drawn, in space pixels, at most.
 *
 * A tile's content must not depend on where the drawn range starts or ends,
 * or every long item would rewrite its tile whenever the range moved. So an
 * item is not clipped at the range but here: far enough that the viewport
 * never gets there (it stays within `maxShift` of the origin, 10⁵ by
 * default), and near enough that single-precision SVG geometry is still well
 * under a pixel.
 */
const ITEM_REACH = 1 << 22;

/**
 * How far past its own tile a label placed after its item may run, in tiles.
 *
 * Two — an eighth of a viewport, the reach of the quarter-viewport tiles'
 * one: the label of an item that ends near a tile's end has the next tiles
 * to run into, and the tile's reservations reach that far, past the range
 * end too, so a tile's labels still depend on the data and not on what else
 * is drawn. A label longer than that is shortened to the reach; one that
 * does not fit even so is given up, and the frame at rest puts it back
 * ({@link restLabels}).
 */
const LABEL_REACH = 2;

/**
 * The reach in pixels, at least: a narrow viewport's tiles are narrow too —
 * 21 px at 337 — and two of them took not even a shortened label, so a
 * label the frame at rest showed was gone for the whole of a gesture.
 * Wider than any shortest label of the densities, and than two tiles of a
 * desktop-wide view.
 */
const MIN_LABEL_REACH_PX = 160;

/** One tile: what it draws, and what it was drawn from. */
interface Tile<T> {
  readonly index: number;
  /**
   * The share of their room its labels were fitted to: 1 for all of it, 0
   * for none (a bare tile, {@link SceneSpace.bare}), and between them for a
   * gesture's tile drawn finer than the scale the view rested at
   * ({@link SceneSpace.rest}).
   */
  readonly fit: number;
  /** The range start, when this is the range's first tile (it takes what starts before). */
  readonly clampedAt: number | undefined;
  /** Selected items among its own, as they were when it was drawn. */
  readonly selection: string;
  readonly ids: ReadonlySet<string>;
  readonly items: SceneElement;
  readonly labelGroup: SceneElement;
  readonly details: readonly SceneElement[];
  readonly drawn: readonly DrawnItem<T>[];
  readonly labels: LabelLayout;
}

/** The tiles drawn at one scale. */
interface Level {
  readonly msPerPx: number;
  /** The scale's binary exponent: tiles of two levels of a cache nest. */
  readonly id: number;
  readonly tiles: Map<number, Tile<unknown>>;
}

interface TileCache {
  /** What every tile depends on, but the scale. A change drops them all. */
  readonly key: readonly unknown[];
  /** The scale's mantissa: every level of the cache has it, a power of two apart. */
  readonly mantissa: number;
  /** The scales kept, the one last drawn last. */
  readonly levels: Level[];
  /** The last frame's content, and what decides it beyond `key`. */
  frameKey: readonly unknown[] | undefined;
  frame: FrameContent<unknown> | undefined;
  /** Every tile the last frame showed: of its own scale, and those that stood in. */
  shown: ReadonlySet<Tile<unknown>> | undefined;
}

/**
 * Scales of one origin kept at once, the current one included.
 *
 * Three: the scale a gesture re-anchors to, the one it came from — which
 * stands in until the new one is drawn — and the one before, so a pinch
 * that turns back finds its tiles still there.
 */
const MAX_LEVELS = 3;

const floatBits = new DataView(new ArrayBuffer(8));

/**
 * A scale as `mantissa × 2^exponent`, the mantissa in [1, 2).
 *
 * Read off the float itself: a scale halved or doubled keeps its mantissa
 * to the bit and moves its exponent by one, where a logarithm could round
 * either way. The exponent names a level the same way whatever was drawn
 * before — a frame's nodes depend on its input, not on the cache's history.
 */
function binaryScale(value: number): { readonly exponent: number; readonly mantissa: number } {
  floatBits.setFloat64(0, value);
  const high = floatBits.getUint32(0);
  floatBits.setUint32(0, (high & 0x800fffff) | (1023 << 20));
  return { exponent: ((high >>> 20) & 0x7ff) - 1023, mantissa: floatBits.getFloat64(0) };
}

/** The level of a scale in a cache, made and moved last; undefined when it does not nest. */
function levelOf(cache: TileCache, msPerPx: number): Level | undefined {
  const { exponent: id, mantissa } = binaryScale(msPerPx);
  if (mantissa !== cache.mantissa) {
    return undefined;
  }
  const at = cache.levels.findIndex((level) => level.id === id);
  const level = at === -1 ? { msPerPx, id, tiles: new Map<number, Tile<unknown>>() } : cache.levels.splice(at, 1)[0] as Level;
  cache.levels.push(level);
  if (cache.levels.length > MAX_LEVELS) {
    cache.levels.shift();
  }
  return level;
}

/** A tile's key in the scene: its index, qualified by its scale's level. */
function tileKey(level: number, index: number): string {
  return `${String(level)}:${String(index)}`;
}

/**
 * A tile drawn at another scale, standing in for this one's.
 *
 * Same origin, a power of two apart: the tile's content times `ratio` is
 * where this scale draws it, so its groups get that one transform and its
 * boxes are scaled for what reads them — the hit tester, the focus ring.
 */
const standIns = new WeakMap<Tile<unknown>, Map<number, Tile<unknown>>>();

function standIn<T>(tile: Tile<T>, ratio: number, orientation: Orientation): Tile<T> {
  let byRatio = standIns.get(tile as Tile<unknown>);
  const cached = byRatio?.get(ratio);
  if (cached !== undefined) {
    return cached as Tile<T>;
  }
  const k = formatNumber(ratio, STRETCH_DECIMALS);
  const transform = orientation === "horizontal" ? `matrix(${k} 0 0 1 0 0)` : `matrix(1 0 0 ${k} 0 0)`;
  const scaled = (box: MainCrossRect): MainCrossRect => ({ ...box, main: box.main * ratio, mainSize: box.mainSize * ratio });
  const stood: Tile<T> = {
    ...tile,
    items: { ...tile.items, attrs: { ...tile.items.attrs, transform } },
    labelGroup: { ...tile.labelGroup, attrs: { ...tile.labelGroup.attrs, transform } },
    details: tile.details.length === 0 ? [] : [{ tag: "g", attrs: { transform }, children: tile.details }],
    drawn: tile.drawn.map((entry) => ({
      ...entry,
      box: scaled(entry.box),
      labelBox: scaled(entry.labelBox),
      rawMain: entry.rawMain * ratio,
      rawEnd: entry.rawEnd * ratio,
    })),
    labels: {
      kept: tile.labels.kept.map((label) => ({ ...label, box: scaled(label.box) })),
      dropped: tile.labels.dropped,
    },
  };
  if (byRatio === undefined) {
    byRatio = new Map();
    standIns.set(tile as Tile<unknown>, byRatio);
  }
  byRatio.set(ratio, stood as Tile<unknown>);
  return stood;
}

/**
 * The tiles drawn for each items array, with what they were drawn from.
 *
 * Keyed by the array, like the layout cache. A frame inside the drawn range
 * matches the frame key and gets the same layer children back, so a
 * patching mount compares one reference per layer; a frame whose range
 * moved draws only the tiles it does not have.
 */
const tileCache = new WeakMap<readonly unknown[], TileCache>();

function selectionOf(ids: ReadonlySet<string>, selected: ReadonlySet<string>): string {
  if (selected.size === 0) {
    return "";
  }
  const here: string[] = [];
  for (const id of selected) {
    if (ids.has(id)) {
      here.push(id);
    }
  }
  return here.sort().join("\u0000");
}

/**
 * Draw the tiles `needed` of the range `[first, last]`.
 *
 * One pass over the layout. An item belongs to the tile it starts in — or,
 * when it starts before the range, to the first tile — and is drawn there
 * once, never cut at a tile edge. Labels are placed per tile, and tiles do
 * not collide without knowing each other's labels, because of what each
 * tile knows of the items:
 *
 * - every item reserves its extent in every tile whose *reach* it crosses —
 *   the tile and the one after it, past the range end too — so no label can
 *   land on an item;
 * - a label placed after its item may run into the next tile, but no
 *   further ({@link LABEL_REACH}), so everything it could land on is
 *   reserved;
 * - and items in a row do not overlap. A label after item A, in A's row,
 *   ends before the next item B of that row starts (B is reserved), and B's
 *   own label starts inside or after B — so the two never meet, whichever
 *   tile placed them. An inside label lies within its own item.
 *
 * An after label need not end inside its own tile: that rule dropped
 * the label of an item near a tile's end that an exact frame keeps.
 */
/**
 * The items of a layout by start, to find the ones near a range of tiles
 * without looking at every item. A frame that draws one tile used to compute
 * the rectangle of all ten thousand to keep the two hundred in it — at a 4x
 * slowdown most of a refill frame's script.
 *
 * Items longer than {@link LONG_SPAN} times the median, and open ones, are
 * listed apart and always looked at: one long item would otherwise widen the
 * window for all of them.
 */
export interface StartIndex {
  /** Positions in `layout.items` of the other items, by start. */
  readonly byStart: Int32Array;
  readonly starts: Float64Array;
  /** The longest of them, in milliseconds. */
  readonly longest: number;
  /** Positions of the long and open ones. */
  readonly long: readonly number[];
}

const LONG_SPAN = 8;
const startIndexes = new WeakMap<Layout<unknown>, StartIndex>();

export function startIndexOf(layout: Layout<unknown>): StartIndex {
  const known = startIndexes.get(layout);
  if (known !== undefined) {
    return known;
  }
  const { items } = layout;
  const lengths = items.map((placed) => (placed.span.open ? Number.POSITIVE_INFINITY : placed.span.end - placed.span.start));
  // The median of the items with a length: an instant spans a millisecond,
  // and with mostly instants every item longer than 8 ms was "long" and
  // looked at in every tile. With only instants, only the open ones are apart.
  const sorted = lengths.filter((length) => length > 1 && length < Infinity).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const limit = median > 0 ? median * LONG_SPAN : Number.MAX_VALUE;
  const long: number[] = [];
  const rest: number[] = [];
  let longest = 0;
  lengths.forEach((length, position) => {
    if (length > limit) {
      long.push(position);
    } else {
      rest.push(position);
      longest = Math.max(longest, length);
    }
  });
  const startOf = (position: number): number => (items[position] as LayoutItem<unknown>).span.start;
  rest.sort((a, b) => startOf(a) - startOf(b) || a - b);
  const index: StartIndex = {
    byStart: Int32Array.from(rest),
    starts: Float64Array.from(rest, startOf),
    longest,
    long,
  };
  startIndexes.set(layout, index);
  return index;
}

/** The first position in `starts` at or after `time`. */
function firstAtOrAfter(starts: Float64Array, time: number): number {
  return search(starts.length, (middle) => (starts[middle] as number) >= time);
}

/**
 * The items that may reach into `[from, to)` pixels of `scale`, in layout
 * order — a superset, widened by a pixel each way and by the minimum item
 * size; the caller's own test decides.
 */
function itemsNear<T>(
  layout: Layout<T>,
  scale: TimeScale,
  from: number,
  to: number,
  minSize: number,
  keep?: (placed: LayoutItem<T>) => boolean,
): readonly LayoutItem<T>[] {
  const [index, first, end] = nearRange(layout, scale, from, to, minSize);
  const positions = [...index.long];
  for (let at = first; at < end; at += 1) {
    positions.push(index.byStart[at] as number);
  }
  // Culled across before the sort: of 10 000 items over 500 lanes, the few
  // hundred in the lanes in view.
  const kept = keep === undefined ? positions : positions.filter((position) => keep(layout.items[position] as LayoutItem<T>));
  kept.sort((a, b) => a - b);
  return kept.map((position) => layout.items[position] as LayoutItem<T>);
}

/** `itemsNear`'s range of the start index: the index, its first position and the end. */
function nearRange(layout: Layout<unknown>, scale: TimeScale, from: number, to: number, minSize: number): [StartIndex, number, number] {
  const index = startIndexOf(layout);
  return [
    index,
    firstAtOrAfter(index.starts, scale.toTime(from - minSize - 1) - index.longest),
    firstAtOrAfter(index.starts, scale.toTime(to + 1)),
  ];
}

function drawTiles<T>(
  options: RenderOptions<T>,
  context: DrawContext<T>,
  tileSize: number,
  first: number,
  last: number,
  needed: readonly number[],
  level: number,
  fit: number,
): Tile<T>[] {
  const { metrics, crossSize, itemScale, layout, scroll, clustering } = context;
  const margin = metrics.rowSize;
  const rangeStart = first * tileSize;
  const rangeEnd = (last + 1) * tileSize;
  const labelReach = Math.max(LABEL_REACH * tileSize, MIN_LABEL_REACH_PX);
  const own = new Map<number, DrawnItem<T>[]>();
  const room = new Map<number, DrawnItem<T>[]>();
  for (const index of needed) {
    own.set(index, []);
    room.set(index, []);
  }
  const measure = labelSpace(metrics, options.measureText ?? estimateTextWidth);
  // A cluster's extent is not its members': with clustering, every item.
  const near =
    clustering === undefined
      ? itemsNear(layout, itemScale, rangeStart - margin, rangeEnd + labelReach, metrics.minItemMainSize, (placed) =>
          crossBoxOf(placed, metrics, scroll, crossSize) !== undefined)
      : layout.items;
  for (const placed of near) {
    const clustered = clustering?.clusterOf(placed.item.id);
    const unit = clustered === undefined ? undefined : clusterUnitOf(placed, clustered, context, measure);
    if (clustered !== undefined && unit === undefined) {
      continue;
    }
    const raw = unit?.raw ?? itemRect(placed, itemScale);
    const reach = unit?.reach ?? raw;
    const cluster = unit?.cluster;
    const end = cluster === undefined && placed.span.open ? ITEM_REACH : Math.min(raw.main + raw.mainSize, ITEM_REACH);
    const rawEnd = raw.main + Math.max(end - raw.main, metrics.minItemMainSize);
    const reachEnd =
      cluster === undefined ? rawEnd : reach.main + Math.max(Math.min(reach.mainSize, ITEM_REACH), metrics.minItemMainSize);
    // Past the range end only to reserve room: an item that starts in the
    // reach of the last tile is one its labels must not land on.
    if (reachEnd <= rangeStart - margin || reach.main >= rangeEnd + labelReach) {
      continue;
    }
    const crossBox = crossBoxOf(raw, metrics, scroll, crossSize);
    if (crossBox === undefined) {
      continue;
    }
    const home = reach.main < rangeStart ? first : Math.floor(reach.main / tileSize);
    const labelStart = Math.max(raw.main, rangeStart);
    const labelEnd = Math.min(rawEnd, ITEM_REACH);
    const ownList = own.get(home);
    // Only what is needed is built; the rest only reserves room.
    let entry: DrawnItem<T> | undefined;
    const build = (): DrawnItem<T> => {
      // Not clipped at the range start either: when the range grows, an item
      // that started before it keeps its attributes and only changes tile.
      const start = Math.max(raw.main, -ITEM_REACH);
      const box = { main: start, mainSize: Math.max(labelEnd - start, metrics.minItemMainSize), ...crossBox };
      const labelSize = Math.max(labelEnd - labelStart, 0);
      return {
        placed,
        ...(cluster === undefined ? {} : { cluster }),
        box,
        labelled: rawEnd > rangeStart && crossBox.cross < crossSize,
        // The same box, mostly: one object per item fewer, for every item a
        // long pan keeps drawn.
        labelBox: labelStart === box.main && labelSize === box.mainSize ? box : { main: labelStart, mainSize: labelSize, ...crossBox },
        rawMain: raw.main,
        rawEnd,
      };
    };
    if (ownList !== undefined) {
      entry = build();
      ownList.push(entry);
    }
    for (const index of needed) {
      if (index === home) {
        continue;
      }
      const tileStart = index * tileSize;
      if (labelEnd > tileStart && labelStart < tileStart + tileSize + labelReach) {
        entry ??= build();
        (room.get(index) as DrawnItem<T>[]).push(entry);
      }
    }
  }

  const share =
    options.maxLabels === undefined ? undefined : Math.ceil(options.maxLabels / TILES_PER_VIEWPORT);
  // The items near a viewport's width from the tile on, at the scale the
  // labels are fitted to — through the start index, as the tile finds its own.
  // Only the count: no list is built.
  const densityAt = (index: number): number => {
    const [start, first, end] = nearRange(layout, itemScale, index * tileSize, (index + TILES_PER_VIEWPORT / fit) * tileSize, metrics.minItemMainSize);
    return start.long.length + Math.max(end - first, 0);
  };
  const selected = new Set(options.selectedIds ?? []);
  const tiles: Tile<T>[] = [];
  for (const index of needed) {
    const drawn = own.get(index) as DrawnItem<T>[];
    const candidates: LabelCandidate[] = [];
    for (const entry of drawn) {
      if (entry.labelled) {
        candidates.push(candidateOf(entry, true));
      }
    }
    for (const entry of room.get(index) as DrawnItem<T>[]) {
      if (entry.labelled) {
        candidates.push(candidateOf(entry, false));
      }
    }
    const labels =
      fit > 0
        ? placeLabels(candidates, {
            mainStart: index * tileSize,
            mainSize: tileSize,
            measure,
            afterReach: labelReach,
            ...(share === undefined ? {} : { maxLabels: share }),
            // How dense the data is from the tile on, a viewport's worth —
            // the viewport the view rested at, during a gesture, like the
            // room: a zoom in from a dense view brings no shortened labels
            // in. From the data alone, so the tile is drawn the same
            // whenever it is.
            ...overflowAt(options, densityAt(index)),
            ...(fit < 1 ? { roomScale: fit } : {}),
          })
        : { kept: [], dropped: [] };
    const nodes = itemNodesOf(options, context, drawn, labels.kept, selected);
    // A cluster's members are all its own: selecting one changes the marker.
    const ids = new Set<string>();
    for (const entry of drawn) {
      if (entry.cluster === undefined) {
        ids.add(entry.placed.item.id);
      } else {
        for (const member of entry.cluster.members) {
          ids.add(member.item.id);
        }
      }
    }
    tiles.push({
      index,
      fit,
      clampedAt: index === first ? rangeStart : undefined,
      selection: selectionOf(ids, selected),
      ids,
      items: { tag: "g", attrs: { class: "tl-tile", "data-tl-tile": tileKey(level, index), role: "none" }, children: nodes.items },
      labelGroup: { tag: "g", attrs: { class: "tl-tile", "data-tl-tile": tileKey(level, index) }, children: nodes.labels },
      details: nodes.details,
      drawn,
      labels,
    });
  }
  return tiles;
}

/** A frame's content in a space: the frame layers for the range, the tiles for the rest. */
function drawSpaceContent<T>(
  options: RenderOptions<T>,
  context: DrawContext<T>,
  space: SceneSpace,
  extent: readonly [number, number],
  view: readonly [number, number],
  baseKey: readonly unknown[],
): FrameContent<T> & { readonly pending: number } {
  const { itemScale, mainSize, orientation } = context;
  const tileSize = mainSize / TILES_PER_VIEWPORT;
  const first = Math.floor(itemScale.toMain(extent[0]) / tileSize);
  const last = Math.max(Math.ceil(itemScale.toMain(extent[1]) / tileSize) - 1, first);
  let cache = tileCache.get(options.items);
  let level = cache !== undefined && sameReferences(cache.key, baseKey) ? levelOf(cache, space.msPerPx) : undefined;
  if (cache === undefined || level === undefined) {
    cache = { key: baseKey, mantissa: binaryScale(space.msPerPx).mantissa, levels: [], frameKey: undefined, frame: undefined, shown: undefined };
    tileCache.set(options.items, cache);
    level = levelOf(cache, space.msPerPx) as Level;
  }
  const frameKey: unknown[] = [
    first,
    last,
    space.msPerPx,
    space.bare,
    space.atRest === true ? undefined : space.rest,
    options.selectedIds,
    options.decorations,
    options.formatTick,
    options.includeStyle,
    options.touchAction,
    options.instanceId,
  ];
  if (cache.frame !== undefined && cache.frameKey !== undefined && sameReferences(cache.frameKey, frameKey)) {
    return { ...(cache.frame as FrameContent<T>), pending: 0 };
  }

  const selected = new Set(options.selectedIds ?? []);
  const rangeStart = first * tileSize;
  // Labels fitted to all of their room, none of it, or — a gesture drawing
  // finer than where the view rested — to what the room was there: a label
  // that fitted before the gesture is there during it, and a zoom in does
  // not bring in the hundreds that only fit once it got there (at ten
  // thousand items, 1.5 % of a wheel zoom's frames missed became 29 %).
  const fit =
    space.bare === true ? 0 : space.atRest !== true && space.rest !== undefined && space.msPerPx < space.rest ? space.msPerPx / space.rest : 1;
  const fresh = (tile: Tile<unknown> | undefined, clampedAt: number | undefined): tile is Tile<unknown> =>
    tile !== undefined && tile.clampedAt === clampedAt && tile.selection === selectionOf(tile.ids, selected);
  const tiles = level.tiles;
  const needed: number[] = [];
  // Drawn before, but not on screen in the last frame: a pinch back to a
  // scale it came from. Showing such a tile costs the browser what drawing
  // it does — every item in it moves back in, at another scale — so while
  // the scale shown instead can stand in, it comes back a budget at a time
  // too (the last notch of a wheel zoom out, 25 ms at a 4x slowdown).
  const onScreen = cache.shown ?? new Set();
  const returning: number[] = [];
  for (let index = first; index <= last; index += 1) {
    const tile = tiles.get(index);
    // A tile with all its labels does for any frame: fitting less is about
    // not adding labels, not about taking away the ones already there.
    if (!fresh(tile, index === first ? rangeStart : undefined) || (tile.fit !== 1 && tile.fit !== fit)) {
      needed.push(index);
    } else if (!onScreen.has(tile)) {
      returning.push(index);
    }
  }

  // Where another scale can stand in, only a budget is drawn now. Never the
  // range's first tile, which takes what starts before the range; never
  // with clusters, which are another grouping at every scale.
  const stood = new Map<number, { readonly tiles: Tile<unknown>[]; readonly ratio: number; readonly covers: number[] }>();
  // Stood-in tiles in view: what a further frame would draw.
  let waiting = 0;
  const paced = [...needed, ...returning].sort((a, b) => a - b);
  if (space.budget !== undefined && context.clustering === undefined && paced.length > 0 && cache.levels.length > 1) {
    const missing = new Set(paced);
    const others = cache.levels
      .filter((other) => other !== level)
      .sort((a, b) => Math.abs(a.id - (level as Level).id) - Math.abs(b.id - (level as Level).id));
    const groups: { readonly key: string; readonly tiles: Tile<unknown>[]; readonly ratio: number; readonly covers: number[] }[] = [];
    const taken = new Set<number>();
    // Of the scales that can stand in, the nearest — unless a farther one's
    // tiles are on screen already: those stand in with a transform, the
    // others come back into the page whole (a wheel zoom's step out, 2,900
    // attributes in one frame, when the scale it started at stood in).
    for (const index of paced) {
      if (index === first || taken.has(index)) {
        continue;
      }
      let chosen: (typeof groups)[number] | undefined;
      for (const other of others) {
        const steps = other.id - level.id;
        const span = 2 ** Math.abs(steps);
        let covers: number[];
        let from: number[];
        if (steps > 0) {
          // A coarser tile covers `span` of these, all of which must be missing.
          const coarse = Math.floor(index / span);
          covers = Array.from({ length: span }, (_, step) => coarse * span + step);
          from = [coarse];
        } else {
          covers = [index];
          from = Array.from({ length: span }, (_, step) => index * span + step);
        }
        if (!covers.every((cover) => cover > first && cover <= last && missing.has(cover) && !taken.has(cover))) {
          continue;
        }
        const old = from.map((at) => other.tiles.get(at));
        if (!old.every((tile) => fresh(tile, undefined))) {
          continue;
        }
        const group = { key: `${String(other.id)}:${String(from[0])}`, tiles: old as Tile<unknown>[], ratio: other.msPerPx / level.msPerPx, covers };
        chosen ??= group;
        if (old.every((tile) => onScreen.has(tile as Tile<unknown>))) {
          chosen = group;
          break;
        }
      }
      if (chosen !== undefined) {
        groups.push(chosen);
        for (const cover of chosen.covers) {
          taken.add(cover);
        }
      }
    }
    // Only what is in view is drawn again, nearest its middle first: a tile
    // off-screen redrawn during a gesture is a frame the gesture misses for
    // nothing, and at rest the space is anchored anew anyway.
    const middle = (view[0] + view[1]) / 2;
    const reach = (group: (typeof groups)[number]): readonly [number, number] => [
      (group.covers[0] as number) * tileSize,
      ((group.covers[group.covers.length - 1] as number) + 1) * tileSize,
    ];
    const inView = groups.filter((group) => {
      const [from, to] = reach(group);
      return to > view[0] && from < view[1];
    });
    inView.sort((a, b) => Math.abs((reach(a)[0] + reach(a)[1]) / 2 - middle) - Math.abs((reach(b)[0] + reach(b)[1]) / 2 - middle));
    const now = new Set(inView.slice(0, space.budget));
    for (const group of groups) {
      if (!now.has(group)) {
        for (const cover of group.covers) {
          stood.set(cover, group);
        }
        if (inView.includes(group)) {
          waiting += group.covers.length;
        }
      }
    }
  }

  const draw = needed.filter((index) => !stood.has(index));
  if (draw.length > 0) {
    for (const tile of drawTiles(options, context, tileSize, first, last, draw, level.id, fit)) {
      tiles.set(tile.index, tile as Tile<unknown>);
    }
  }
  for (const index of [...tiles.keys()]) {
    if (index < first || index > last) {
      tiles.delete(index);
    }
  }
  // Another scale's tiles are kept whole, however far they lie: a pinch that
  // goes back out reaches them again, and finds them drawn. A level lives
  // until a fourth scale or a new origin lets it go.

  const shown: Tile<T>[] = [];
  const emitted = new Set<object>();
  const now = new Set<Tile<unknown>>();
  for (let index = first; index <= last; index += 1) {
    const group = stood.get(index);
    if (group === undefined) {
      const tile = tiles.get(index) as Tile<T>;
      shown.push(tile);
      now.add(tile as Tile<unknown>);
    } else if (!emitted.has(group)) {
      emitted.add(group);
      for (const tile of group.tiles) {
        shown.push(standIn(tile as Tile<T>, group.ratio, orientation));
        now.add(tile);
      }
    }
  }
  const rangeTime: readonly [number, number] = [
    itemScale.toTime(rangeStart),
    itemScale.toTime((last + 1) * tileSize),
  ];
  const frame = drawFrame(options, context, createTimeScale(rangeTime, (last + 1 - first) * tileSize));
  const content: FrameContent<T> = {
    ...frame,
    items: shown.map((tile) => tile.items),
    labelNodes: shown.map((tile) => tile.labelGroup),
    details: shown.flatMap((tile) => tile.details),
    labels: {
      kept: shown.flatMap((tile) => tile.labels.kept),
      dropped: shown.flatMap((tile) => tile.labels.dropped),
    },
    drawn: shown.flatMap((tile) => tile.drawn),
  };
  // A frame with stand-ins is not one to hand back: the next draws more.
  cache.frameKey = stood.size === 0 ? frameKey : undefined;
  cache.frame = stood.size === 0 ? (content as FrameContent<unknown>) : undefined;
  cache.shown = now;
  return { ...content, pending: waiting };
}

/**
 * The labels a frame at rest adds, in a space.
 *
 * Content in a space is drawn for the range, tile by tile, so two labels an
 * exact frame keeps can be missing: an item that starts left of the
 * viewport has its label where the item starts — off-screen — where an
 * exact frame pins it to the viewport edge; and a label after a long item
 * may need more room than the tiles reserve ({@link LABEL_REACH}). At rest
 * this places the viewport's labels the way an exact frame does — the same
 * candidates, clipped to the viewport, the same rules — and draws every one
 * it keeps whose item shows no label of its own on screen. Only as an
 * addition: the tiles' labels stay exactly as drawn, so stopping and
 * starting a gesture leaves them alone, and the labels they show are
 * obstacles here, so nothing added lands on one.
 *
 * Built from what the frame drew, not from the data: the extent covers the
 * viewport, so every item the exact frame would label is among them.
 *
 * With `maxLabels` the rest places the viewport's labels alone and they
 * *replace* the tiles' (`replace`). A ceiling is a property of the whole
 * frame, which tiles cannot hold — each holds a share of it, so a viewport
 * showing parts of five tiles could show five labels under a ceiling of one.
 * At rest the frame holds it exactly; during a gesture each tile its share.
 */
/** A frame's view, and where its space is on it: screen = stretch * space + shift. */
interface ViewOf<T> {
  readonly context: DrawContext<T>;
  readonly domain: readonly [number, number];
  readonly stretch: number;
  readonly shift: number;
}

/**
 * Labels placed the exact frame's way, in the viewport's pixels: `entries`
 * as candidates — with their text where `wanted` says so, as room taken
 * otherwise — and the tiles' labels `inTiles` keeps as room taken too.
 * Rendered, and reported in the space; `inView` draws the nodes in the
 * viewport's pixels instead, for a group that undoes the stretch.
 */
function placeInView<T>(
  view: ViewOf<T>,
  options: RenderOptions<T>,
  tiles: readonly PlacedLabel[],
  inTiles: (main: number, size: number, label: PlacedLabel) => boolean,
  entries: readonly DrawnItem<T>[],
  wanted: (id: string) => boolean,
  density: number,
  inView = false,
): { readonly nodes: SceneElement[]; readonly kept: PlacedLabel[]; readonly dropped: LabelLayout["dropped"] } {
  const { context, domain, stretch, shift } = view;
  const { mainSize, metrics, projector } = context;
  const candidates: LabelCandidate[] = [];
  for (const label of tiles) {
    const main = stretch * label.box.main + shift;
    const size = stretch * label.box.mainSize;
    if (inTiles(main, size, label)) {
      candidates.push({ id: `\u0000${label.id}`, text: "", box: { ...label.box, main, mainSize: size }, row: label.row, rowSpan: label.rowSpan });
    }
  }
  const byId = new Map<string, DrawnItem<T>>();
  for (const entry of exactEntries(entries.map((entry) => entry.placed), context, domain, options.measureText)) {
    if (entry.labelled) {
      const own = candidateOf(entry, true);
      if (wanted(own.id)) {
        byId.set(own.id, entry);
        candidates.push(own);
      } else {
        candidates.push({ ...own, text: "" });
      }
    }
  }
  const placed = placeLabels(candidates, {
    mainSize,
    measure: labelSpace(metrics, options.measureText ?? estimateTextWidth),
    ...(options.maxLabels === undefined || inView ? {} : { maxLabels: options.maxLabels }),
    ...overflowAt(options, density),
  });
  const renderLabel = options.hooks?.renderLabel ?? defaultLabelNode;
  const nodes: SceneElement[] = [];
  const kept: PlacedLabel[] = [];
  for (const exact of placed.kept) {
    // Only a wanted candidate carries text, so every kept label has one.
    const entry = byId.get(exact.id) as DrawnItem<T>;
    // Back into the space, which the layer's transform maps onto the viewport.
    const label: PlacedLabel = {
      ...exact,
      box: { ...exact.box, main: (exact.box.main - shift) / stretch, mainSize: exact.box.mainSize / stretch },
    };
    const node = renderLabel({
      placed: entry.placed,
      ...(entry.cluster === undefined ? {} : { cluster: entry.cluster }),
      label: inView ? exact : label,
      metrics,
      projector,
    });
    if (node !== null) {
      nodes.push(node);
      kept.push(label);
    }
  }
  return { nodes, kept, dropped: placed.dropped };
}

function restLabels<T>(
  content: FrameContent<T>,
  view: ViewOf<T>,
  options: RenderOptions<T>,
): { readonly nodes: SceneElement[]; readonly kept: PlacedLabel[]; readonly dropped?: LabelLayout["dropped"] } {
  const replace = options.maxLabels !== undefined;
  // What a tile shows on screen is room taken, and its item needs no other.
  const shown = new Set<string>();
  const { mainSize } = view.context;
  const placed = placeInView(
    view,
    options,
    replace ? [] : content.labels.kept,
    (main, size, label) => {
      const on = main < mainSize && main + size > 0;
      if (on) {
        shown.add(label.id);
      }
      return on;
    },
    content.drawn,
    (id) => !shown.has(id),
    content.drawn.filter((entry) => entry.labelled).length,
  );
  return replace ? placed : { nodes: placed.nodes, kept: placed.kept };
}

/**
 * The labels a frame during a gesture adds, in a space: the edges'.
 *
 * During a gesture the tiles' labels stay where the tiles put them, so a pan
 * or a zoom step writes nothing for them. Tiles do not know the view, so two
 * labels can then be off the screen while their item is on it: the one at
 * the start of an item the near edge cuts off, and the one after an item the
 * far edge cuts off, which a tile placed past that edge. At rest the frame
 * puts both on the visible part ({@link restLabels}); before 1.0.0-rc.5 they
 * vanished at the first frame of a gesture and came back at the last — a
 * label that blinked. This places those, and only those, the way the frame
 * at rest does: in the viewport's pixels, against what is in their rows —
 * the items there, and the tiles' labels on screen.
 *
 * Drawn unstretched: the nodes go into a group that undoes the layer's
 * stretch, so a label is as wide on the screen as it was placed — in the
 * stretched layer it would be wider than its room, by up to the stretch.
 * Cheap on purpose, since it runs on every frame of a gesture: one pass over
 * what is drawn finds the items an edge cuts, a couple a row at most, and
 * only their rows are placed.
 */
function edgeLabels<T>(
  content: FrameContent<T>,
  view: ViewOf<T>,
  options: RenderOptions<T>,
): { readonly nodes: SceneElement[]; readonly kept: PlacedLabel[] } {
  const { context, stretch, shift } = view;
  const { mainSize, metrics } = context;
  const low = -shift / stretch;
  const high = (mainSize - shift) / stretch;
  // Only an item a tile gave a label, which is off the screen: a tile has
  // at least the room the view has — its item is not clipped to the view —
  // so what a tile gave up does not fit here either. A dense view whose
  // tiles fit no label does nothing here at all.
  const offScreen = new Set<string>();
  const onScreen = new Set<string>();
  for (const label of content.labels.kept) {
    const main = stretch * label.box.main + shift;
    (main < mainSize && main + stretch * label.box.mainSize > 0 ? onScreen : offScreen).add(label.id);
  }
  const idOf = (entry: DrawnItem<T>): string => entry.cluster?.id ?? entry.placed.item.id;
  let inView = 0;
  const cut = content.drawn.filter((entry) => {
    if (!(entry.labelled && entry.rawEnd > low && entry.rawMain < high)) {
      return false;
    }
    inView += 1;
    const id = idOf(entry);
    return (entry.rawMain < low || entry.rawEnd > high) && offScreen.has(id) && !onScreen.has(id);
  });
  if (cut.length === 0) {
    return { nodes: [], kept: [] };
  }
  const rowsOf = (entry: DrawnItem<T>): readonly [number, number] =>
    entry.cluster === undefined ? [entry.placed.row, entry.placed.row + Math.max(entry.placed.sublaneSpan, 1)] : [entry.cluster.row, entry.cluster.row + 1];
  const rows = new Set<number>();
  for (const entry of cut) {
    const [from, to] = rowsOf(entry);
    for (let row = from; row < to; row += 1) {
      rows.add(row);
    }
  }
  const inRows = (from: number, to: number): boolean => {
    for (let row = from; row < to; row += 1) {
      if (rows.has(row)) {
        return true;
      }
    }
    return false;
  };
  // What the placement can reach, in the viewport's pixels, near each edge:
  // from the edge to the widest text past the furthest visible end of what
  // the near edge cuts, and from the earliest visible start of what the far
  // edge cuts to that edge. Two narrow windows, not one across the view: a
  // dense frame cuts an item in every row at both edges.
  const measure = labelSpace(metrics, options.measureText ?? estimateTextWidth);
  let nearTo = 0;
  let farFrom = mainSize;
  for (const entry of cut) {
    if (entry.rawMain < low) {
      const text = entry.cluster === undefined ? (entry.placed.item.label ?? "") : String(entry.cluster.members.length);
      nearTo = Math.max(nearTo, Math.min(Math.min(stretch * entry.rawEnd + shift, mainSize) + measure(text).main, mainSize));
    }
    if (entry.rawEnd > high) {
      farFrom = Math.min(farFrom, Math.max(stretch * entry.rawMain + shift, 0));
    }
  }
  const inWindow = (from: number, to: number): boolean => (nearTo > 0 && from < nearTo && to > 0) || (farFrom < mainSize && from < mainSize && to > farFrom);
  const cutIds = new Set(cut.map(idOf));
  const placed = placeInView(
    view,
    options,
    content.labels.kept,
    (main, size, label) => inWindow(main, main + size) && inRows(label.row, label.row + Math.max(label.rowSpan, 1)),
    content.drawn.filter((entry) => {
      const [first, last] = rowsOf(entry);
      return inRows(first, last) && inWindow(stretch * entry.rawMain + shift, stretch * entry.rawEnd + shift);
    }),
    (id) => cutIds.has(id),
    inView,
    true,
  );
  if (placed.nodes.length === 0) {
    return { nodes: [], kept: [] };
  }
  const k = formatNumber(1 / stretch, STRETCH_DECIMALS);
  const t = formatNumber(-shift / stretch);
  const transform = context.orientation === "horizontal" ? `matrix(${k} 0 0 1 ${t} 0)` : `matrix(1 0 0 ${k} 0 ${t})`;
  return { nodes: [{ tag: "g", attrs: { class: "tl-edge-labels", transform }, children: placed.nodes }], kept: placed.kept };
}

/**
 * The rest labels of the last frame at rest, per items array.
 *
 * A space at rest grows its overscan a strip per frame, and every one of
 * those frames is at rest: without this, each would place the viewport's
 * labels again (1 ms of script at 10 000 items, 4 ms at a 4x slowdown),
 * though nothing in view changed. What decides them is what overlaps the
 * view — the items, and the boxes of the tiles' labels — and the view. Keyed
 * by those, not by the entries: when the overscan grows before the view, the
 * items that start there and reach into it move to the new first tile as new
 * entries, and keyed by entry each such frame placed them all again.
 */
const restCache = new WeakMap<readonly unknown[], { readonly key: readonly unknown[]; readonly value: ReturnType<typeof restLabels> }>();

function cachedRestLabels<T>(
  content: FrameContent<T>,
  view: { readonly context: DrawContext<T>; readonly domain: readonly [number, number] },
  toSpace: { readonly stretch: number; readonly shift: number },
  options: RenderOptions<T>,
): ReturnType<typeof restLabels> {
  const { stretch, shift } = toSpace;
  const low = -shift / stretch;
  const high = (view.context.mainSize - shift) / stretch;
  // Only what overlaps the view can be an exact frame's candidate.
  const drawn = content.drawn.filter((entry) => entry.rawEnd > low && entry.rawMain < high);
  const kept = content.labels.kept.filter((label) => label.box.main < high && label.box.main + label.box.mainSize > low);
  const key: unknown[] = [
    view.domain[0],
    view.domain[1],
    stretch,
    shift,
    view.context.scroll,
    view.context.crossSize,
    view.context.mainSize,
    view.context.metrics.density,
    view.context.metrics.orientation,
    view.context.clustering,
    options.measureText,
    options.maxLabels,
    options.labelOverflow,
    options.hooks,
    drawn.length,
    kept.length,
    ...drawn.flatMap((entry) => [entry.placed, entry.cluster]),
    ...kept.flatMap((label) => [label.id, label.row, label.rowSpan, label.box.main, label.box.mainSize, label.box.cross, label.box.crossSize]),
  ];
  const cached = restCache.get(options.items);
  if (cached !== undefined && sameReferences(cached.key, key)) {
    return cached.value;
  }
  const value = restLabels({ ...content, drawn, labels: { kept, dropped: [] } }, { ...view, stretch, shift }, options);
  restCache.set(options.items, { key, value });
  return value;
}

/** Compose one frame. Pure: same input, same bytes. */
/**
 * The axis's context label: the coarser unit the view starts in, held at the
 * start of the axis. Ticks of days say "02 09 16", and a reader needs the
 * month and the year somewhere on screen — a major tick says it only where a
 * month starts, and a week's steps may never land on one.
 *
 * Drawn in the viewport's pixels, in a layer of its own with no transform:
 * a pan moves the ticks under it and rewrites nothing here until the text
 * changes. Its background is the surface, so a tick label sliding under it
 * goes out of sight instead of being drawn over. One `formatTick` call a
 * frame, with the view's start.
 */
function axisContextNodes<T>(
  options: RenderOptions<T>,
  context: DrawContext<T>,
  scale: TimeScale,
  ticks: readonly Tick[],
  start: number,
): SceneElement[] {
  const granularity = ticks[0]?.granularity;
  if (options.axisContext === false || granularity === undefined) {
    return [];
  }
  const { metrics, projector, timeZone } = context;
  const formatTick = options.formatTick ?? defaultTickLabel;
  const measure = labelSpace(metrics, options.measureText ?? estimateTextWidth, metrics.tickFontSize);
  const labelOf = (time: number): string => formatTick({ time, granularity, major: true, context: true }, timeZone);
  let text = labelOf(start);
  let need = measure(text);
  // A view that starts just before a unit begins — a day before the month
  // whose first tick is right there — says that unit: the sliver before it
  // is under the label anyway.
  const first = ticks.find((tick) => tick.time >= start);
  if (first !== undefined && scale.toMain(first.time) < need.main) {
    const next = labelOf(first.time);
    if (next !== text) {
      text = next;
      need = measure(text);
    }
  }
  if (text === "" || need.cross > metrics.axisSize || need.main > context.mainSize / 2) {
    return [];
  }
  // The background reaches past every tick label that starts under it, so
  // none is left cut in half at its edge.
  let end = need.main;
  for (const tick of ticks) {
    const main = scale.toMain(tick.time);
    if (main >= end) {
      if (main > 0) {
        break;
      }
      continue;
    }
    if (main >= 0) {
      end = Math.max(end, main + measure(formatTick(tick, timeZone)).main);
    }
  }
  return [
    { tag: "rect", attrs: { class: "tl-axis-context", ...rectAttrs({ main: 0, mainSize: end, cross: 0, crossSize: metrics.axisSize }, projector) } },
    textNode({ main: 0, mainSize: need.main, cross: 0, crossSize: metrics.axisSize }, text, projector, "tl-tick-label tl-tick-label--major tl-tick-label--context", metrics.labelPadding),
  ];
}

/**
 * Draw one frame: lay the items out in their lanes, place the ticks and the
 * labels, cluster what does not fit, and return the scene with the layout it
 * was drawn from. Pure — no DOM, no clock: the same options give the same
 * scene, which is what a server renders and a client hydrates.
 */
export function renderTimeline<T = unknown>(options: RenderOptions<T>): RenderResult<T> {
  const orientation: Orientation = options.orientation ?? "horizontal";
  const density: Density = options.density ?? "comfortable";
  const timeZone = options.timeZone ?? DEFAULT_TIME_ZONE;
  const metrics = (options.metrics ?? densityMetrics)(density, orientation);
  const projector = createProjector(orientation);
  const { mainSize, crossSize } = containerExtents(options.width, options.height, orientation);
  // NaN is not an empty container but a host's bug: it drew a NaN viewBox, or threw deep inside (R31).
  if (!Number.isFinite(mainSize + crossSize)) throw new RangeError("width and height must be finite");
  const domain: readonly [number, number] = [
    toTimeMs(options.domain[0]),
    toTimeMs(options.domain[1]),
  ];
  const warp = options.hiddenDates;
  // A window wholly inside hidden time shows nothing, as an empty container does.
  if (mainSize <= 0 || crossSize <= 0 || (warp !== undefined && !(warp.toShown(domain[1]) > warp.toShown(domain[0])))) {
    // A container that measures nothing is not an error. It is a hidden tab,
    // a collapsed panel, a `content-visibility` element, or simply a frame
    // rendered before the browser has laid anything out — and a library that
    // throws there takes down the host's render loop on page load. The honest
    // answer is an empty frame with the right root, which the host can mount
    // and which becomes a real frame on the next measured render.
    return emptyFrame(options, {
      orientation,
      density,
      metrics,
      mainSize,
      crossSize,
      domain,
      theme: resolveTheme(options.theme ?? "auto"),
    });
  }
  const scale = createTimeScale(domain, mainSize, warp);
  const layout = options.layout ?? cachedLayout(options.items, options.lanes, options.packMode, timeZone, metrics);
  const scroll = options.crossOffset ?? 0;
  if (!Number.isFinite(scroll)) {
    throw new RangeError(`crossOffset must be a finite number, got ${String(scroll)}`);
  }

  // --- the space ------------------------------------------------------------
  const space = warp === undefined ? options.space : undefined;
  if (space !== undefined && !(Number.isFinite(space.origin) && Number.isFinite(space.msPerPx) && space.msPerPx > 0)) {
    throw new RangeError("space needs a finite origin and a positive, finite msPerPx");
  }
  const extent: readonly [number, number] = space?.extent ?? domain;
  if (space !== undefined && !(Number.isFinite(extent[0]) && Number.isFinite(extent[1]) && extent[1] > extent[0])) {
    throw new RangeError("space.extent needs two finite instants, the second after the first");
  }
  const itemScale =
    space === undefined
      ? scale
      : createTimeScale([space.origin, space.origin + mainSize * space.msPerPx], mainSize);
  // Decided at the item scale's zoom: in a space that holds still for a
  // whole gesture, so a pinch stretches markers instead of re-clustering
  // them on every frame — the same bargain the items make.
  const clusterSetting = options.cluster ?? false;
  const clustering =
    clusterSetting === false
      ? undefined
      : clusterLayout(layout, itemScale.msPerPx, {
          ...(clusterSetting === true ? {} : clusterSetting),
          minItemMainSize: metrics.minItemMainSize,
        });
  // screen = stretch * space + shift, along the main axis.
  const stretch = itemScale.msPerPx / scale.msPerPx;
  const shift = (itemScale.domain[0] - domain[0]) / scale.msPerPx;
  const context: DrawContext<T> = {
    orientation,
    metrics,
    projector,
    mainSize,
    crossSize,
    itemScale,
    layout,
    scroll,
    timeZone,
    semantics: semanticsOf(options, layout, timeZone, clustering),
    clustering,
  };

  let content: FrameContent<T>;
  let rangeStart = 0;
  let pending = 0;
  if (space === undefined) {
    const exact = drawExactItems(options, context, domain);
    content = {
      ...drawFrame(options, context, scale),
      items: exact.items,
      labelNodes: exact.labelNodes,
      details: exact.details,
      labels: exact.labels,
      drawn: exact.drawn,
    };
  } else {
    // Everything every tile depends on, and nothing that only moves it.
    const baseKey: unknown[] = [
      layout,
      space.origin,
      // The scale is a level of the cache — unless clusters are on, which
      // group differently at every scale: then a new scale is a new cache.
      clustering === undefined ? undefined : space.msPerPx,
      options.width,
      options.height,
      orientation,
      density,
      options.theme,
      options.measureText,
      options.maxLabels,
      options.labelOverflow,
      options.hooks,
      scroll,
      // The accessible names and ids are part of every item node.
      options.interactive,
      options.locale,
      timeZone,
      options.instanceId,
      // Which items are one marker, and how wide it is drawn.
      clustering,
    ];
    const spaced = drawSpaceContent(options, context, space, extent, [-shift / stretch, (mainSize - shift) / stretch], baseKey);
    pending = spaced.pending;
    content = spaced;
    const tileSize = mainSize / TILES_PER_VIEWPORT;
    rangeStart = Math.floor(itemScale.toMain(extent[0]) / tileSize) * tileSize;
  }

  // --- the scene ----------------------------------------------------------
  // The one attribute a pan or a zoom step writes for what is already drawn.
  let itemTransform: string | undefined;
  let frameTransform: string | undefined;
  let labelLayer: readonly SceneElement[] = content.labelNodes;
  if (space !== undefined) {
    const k = formatNumber(stretch, STRETCH_DECIMALS);
    const matrix = (t: number): string =>
      orientation === "horizontal"
        ? `matrix(${k} 0 0 1 ${formatNumber(t)} 0)`
        : `matrix(1 0 0 ${k} 0 ${formatNumber(t)})`;
    itemTransform = matrix(shift);
    // Axis, lanes and decorations are drawn from the range's start, so where
    // that start is in the space is part of their transform.
    frameTransform = matrix(shift + stretch * rangeStart);
    // Labels added to what is drawn: at rest, or at the edges while moving.
    let extra: { readonly nodes: readonly SceneElement[]; readonly kept: readonly PlacedLabel[] } | undefined;
    if (space.atRest === true) {
      const rest = cachedRestLabels(content, { context: { ...context, itemScale: scale }, domain }, { stretch, shift }, options);
      if (rest.dropped !== undefined) {
        labelLayer = rest.nodes;
        content = { ...content, labels: { kept: rest.kept, dropped: rest.dropped } };
      } else {
        extra = rest;
      }
    } else if (space.bare !== true) {
      extra = edgeLabels(content, { context: { ...context, itemScale: scale }, domain, stretch, shift }, options);
    }
    if (extra !== undefined && extra.nodes.length > 0) {
      labelLayer = [...content.labelNodes, ...extra.nodes];
      // What is drawn is what is reported: the added labels are kept, and
      // no longer dropped.
      const added = new Set(extra.kept.map((label) => label.id));
      content = {
        ...content,
        labels: {
          kept: [...content.labels.kept, ...extra.kept],
          dropped: content.labels.dropped.filter((label) => !added.has(label.id)),
        },
      };
    }
  }
  const theme = resolveTheme(options.theme ?? "auto");
  const interactive = options.interactive !== false;
  // The focus ring: drawn per frame, outside every cache, around the item
  // the keyboard is on — when it is drawn at all. A separate shape, because
  // the item's own outline already says "selected".
  const focused =
    interactive && options.focusedId !== undefined && options.focusedId !== null
      ? content.drawn.find((entry) =>
          entry.cluster === undefined
            ? entry.placed.item.id === options.focusedId
            : entry.cluster.members.some((member) => member.item.id === options.focusedId),
        )
      : undefined;
  let overlay = content.details;
  if (options.loading !== undefined && options.loading.length > 0) {
    // The overlay is in the items' space; the view is this part of it.
    const view: readonly [number, number] =
      space === undefined ? [0, mainSize] : [-shift / stretch, (mainSize - shift) / stretch];
    const marks = loadingMarks(options.loading, itemScale, view[0], view[1], metrics, projector);
    if (marks.length > 0) {
      overlay = [...marks, ...overlay];
    }
  }
  if (focused !== undefined) {
    const gap = FOCUS_RING_GAP;
    overlay = [
      ...overlay,
      {
        tag: "rect",
        attrs: {
          class: "tl-focus-ring",
          ...rectAttrs(
            {
              main: focused.box.main - gap,
              mainSize: focused.box.mainSize + 2 * gap,
              cross: focused.box.cross - gap,
              crossSize: focused.box.crossSize + 2 * gap,
            },
            projector,
          ),
          rx: metrics.cornerRadius + gap,
        },
      },
    ];
  }
  const children: SceneElement[] = [];
  if (content.style !== undefined) {
    children.push(content.style);
  }
  children.push(
    {
      tag: "rect",
      attrs: {
        class: "tl-surface",
        x: 0,
        y: 0,
        width: options.width,
        height: options.height,
        "aria-hidden": interactive ? "true" : undefined,
      },
    },
    layer("background", content.background, frameTransform, interactive),
    layer("axis", content.axis, frameTransform, interactive),
    layer("lanes", content.lanes, frameTransform, interactive),
    layer("items", content.items, itemTransform, interactive),
    layer("labels", labelLayer, itemTransform, interactive),
    layer("foreground", content.foreground, frameTransform, interactive),
    layer("overlay", overlay, itemTransform, interactive),
    layer("context", axisContextNodes(options, context, scale, content.ticks, domain[0]), undefined, interactive),
  );

  const scene: SceneElement = {
    tag: "svg",
    attrs: {
      xmlns: "http://www.w3.org/2000/svg",
      class: "tl",
      viewBox: `0 0 ${String(options.width)} ${String(options.height)}`,
      width: options.width,
      height: options.height,
      "data-tl-orientation": orientation,
      "data-tl-density": density,
      "data-tl-theme": theme?.name,
      "data-tl-instance": options.instanceId,
      ...rootSemantics(
        options,
        orientation,
        focused === undefined
          ? undefined
          : focused.cluster === undefined
            ? itemDomId(context.semantics?.prefix ?? "tl", focused.placed.item.id)
            : clusterDomId(context.semantics?.prefix ?? "tl", focused.cluster.id),
        holdsOption(content.items),
      ),
      "aria-busy": busyIn(options.loading, domain) ? "true" : undefined,
    },
    children,
  };

  return {
    scene,
    layout,
    ticks: content.ticks,
    labels: content.labels,
    viewport: {
      domain,
      orientation,
      density,
      mainSize,
      crossSize,
      msPerPx: scale.msPerPx,
    },
    contentCrossSize: layout.crossSize + metrics.axisSize,
    visibleCount: content.drawn.reduce((sum, entry) => sum + (entry.cluster?.members.length ?? 1), 0),
    ...(clustering === undefined ? {} : { clustering }),
    clusters: markersOf(content.drawn, stretch, shift),
    pendingTiles: pending,
  };
}

/** The drawn markers, in the viewport's pixels: a space's boxes through its transform. */
function markersOf<T>(drawn: readonly DrawnItem<T>[], stretch: number, shift: number): ClusterMarker<T>[] {
  const markers: ClusterMarker<T>[] = [];
  for (const entry of drawn) {
    if (entry.cluster !== undefined) {
      const box = entry.box;
      markers.push({
        cluster: entry.cluster,
        box: { ...box, main: stretch * box.main + shift, mainSize: stretch * box.mainSize },
      });
    }
  }
  return markers;
}
