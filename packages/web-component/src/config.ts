/**
 * What a timeline is configured with, and how a configuration becomes a
 * frame.
 *
 * One module, shared by the live instance and the server renderer, for one
 * reason: hydration. A server that drew from one set of defaults and a
 * client that drew from another would hand the browser two different
 * pictures of the same timeline, and the patch between them is a visible
 * jump on load. Here the server's frame and the client's first frame come
 * from the same function, so for the same size they are the same frame.
 *
 * Nothing in this file touches the DOM: it runs in Node.
 */

import {
  createTimeScale,
  densityMetrics,
  fitDensity,
  planSceneSpace,
  resolveDensity,
  resolveOrientation,
  toTimeMs,
} from "@temporeum/timeline-core";
import type { Dependency } from "@temporeum/timeline-core/gantt";
import type { Group, GroupView } from "@temporeum/timeline-core/groups";
import type { CreateItem, SplitItems, TemplateOptions } from "@temporeum/timeline-core/items";
import type { Resource } from "@temporeum/timeline-core/resources";
import type { HiddenDateRange, HiddenDates, MinimapGeometry, RangeSelectOptions, RollingOptions, TimeBar, ZoomPreset } from "@temporeum/timeline-core/tools";
import type { Direction } from "@temporeum/timeline-core/intl";
import { resolveStrings, sayIn } from "@temporeum/timeline-core/words";
import type { Strings } from "@temporeum/timeline-core/words";

import { plugin, pluginIf, requireKinds } from "./plugins.js";
import type {
  ClusterOptions,
  Decoration,
  Density,
  DensityMetrics,
  DensitySetting,
  DomainLimits,
  EditingOptions,
  MetricsProvider,
  InteractionOptions,
  Item,
  ItemsSource,
  LabelOverflow,
  Lane,
  LoadingRange,
  MeasureText,
  Orientation,
  OrientationSetting,
  PackMode,
  Layout,
  RenderHooks,
  RenderOptions,
  RenderResult,
  SceneElement,
  SceneSpace,
  ThemeSetting,
  Tick,
  TimeInput,
  TimeMs,
  TouchActionMode,
} from "@temporeum/timeline-core";

/** Editing rules, plus whether a drag may carry an item into another lane. */
export interface TimelineEditingOptions<T = unknown> extends EditingOptions<T> {
  /** Let a move change the item's lane. Off by default. */
  readonly crossLane?: boolean | undefined;
  /** Where the snap grid is anchored. The epoch by default. */
  readonly snapOrigin?: TimeInput | undefined;
  /** Smallest duration a resize may squash an item to, in milliseconds. */
  readonly minDurationMs?: number | undefined;
  /**
   * Let the reader add items: a double tap on empty lane space, or `n` /
   * `Insert` (with `editing.enabled`). A double tap then adds instead of
   * zooming in; the axis band still zooms. Off by default.
   */
  readonly add?: boolean | undefined;
  /**
   * Let the reader remove items: the remove handle drawn on a selected item,
   * or `Delete` / `Backspace` on the focused one. Off by default.
   */
  readonly remove?: boolean | undefined;
  /**
   * Accept items dragged in from outside the timeline (HTML drag and drop
   * with the `application/x-temporeum-item` type). Its keyboard twin is the
   * instance's `dropItem`. Off by default.
   */
  readonly drop?: boolean | undefined;
  /** The item an add makes. A plain range with a free `item-N` id by default. */
  readonly createItem?: CreateItem<T> | undefined;
}

/** The Gantt chart's part of a configuration. See `@temporeum/timeline-core/gantt`. */
export interface TimelineGanttOptions {
  /**
   * Arrows between items: `from` the predecessor `to` the successor, joining
   * the edges the `type` names (`FS` by default). Drawn under the items, and
   * named in each item's accessible name; `[` and `]` go to a predecessor
   * and a successor. The library never moves a task for them.
   */
  readonly dependencies?: readonly Dependency[] | undefined;
  /**
   * Draw only the arrows that can be seen. On by default; off draws every
   * arrow, every frame — it is the benchmark's control, not a setting a
   * timeline needs.
   */
  readonly cull?: boolean | undefined;
}

/** How a resource view measures and draws the load. See `@temporeum/timeline-core/resources`. */
export interface TimelineResourceOptions<T = unknown> {
  /** How much of its resource an assignment takes. 1 by default. */
  readonly unitsOf?: ((item: Item<T>) => number) | undefined;
  /**
   * A load lane under each resource's lane, with the load drawn against the
   * capacity. On by default; off keeps the overload bands and the
   * accessible names, and draws no histogram.
   */
  readonly histogram?: boolean | undefined;
  /** The load lane's size across, in CSS pixels. 24 by default. */
  readonly loadSize?: number | undefined;
  /**
   * Draw only the load that can be seen. On by default; off draws every
   * resource's load over all time, every frame — it is the benchmark's
   * control, not a setting a timeline needs.
   */
  readonly cull?: boolean | undefined;
}

/**
 * Everything a timeline is configured with.
 *
 * Every field is optional and every field can change later through
 * `update()`; the defaults are what an empty `<temporeum-timeline>` shows.
 */
export interface TimelineConfig<T = unknown> {
  /**
   * The items, or a function that fetches the ones in a window. A function
   * is asked for the domain about to be drawn and aborted when the view
   * moves on (`createItemLoader`).
   */
  readonly items?: ItemsSource<T> | undefined;
  readonly lanes?: readonly Lane[] | undefined;
  /**
   * Nested groups. Each group is a header row — click it, or press `Enter`,
   * to collapse it; drag it, or press `Alt` with an arrow, to reorder it —
   * and the rows of its own items, which name it as their `laneId`. When
   * given, `lanes` is ignored.
   */
  readonly groups?: readonly Group[] | undefined;
  /**
   * Each item's picture as HTML — sanitised: scripts, handlers and anything
   * outside an allow-list are dropped (`templateOptions`). The template
   * replaces the item's label; its accessible name stays the label.
   */
  readonly template?: ((item: Item<T>) => string | null) | undefined;
  readonly templateOptions?: TemplateOptions | undefined;
  /**
   * Leave each item — or those the function picks — an empty box a framework
   * renders into: a `<div data-tl-slot>` over the item, listed by
   * `timeline.slots` and the `slotsChanged` event after each frame that
   * changed them. What the React and Vue components' `renderItem` and
   * `#item` slot draw with. Needs the `/items` plugin, as `template` does.
   */
  readonly slots?: (boolean | ((item: Item<T>) => boolean)) | undefined;
  /**
   * Draw the timeline as a Gantt chart: dependency arrows, each item's
   * `progress` and `baseline`, and `kind: "milestone"` diamonds. The task
   * table beside it is `mountTaskGrid`.
   */
  readonly gantt?: TimelineGanttOptions | undefined;
  /**
   * Draw the timeline as a resource view: the resources are the lanes — or,
   * with `lanes` or `groups`, they say which of those lanes are resources —
   * and an item in a resource's lane is work assigned to it. Under each
   * resource a load lane shows how loaded it is against its `capacity`;
   * where it is overbooked its lane is banded and its items say so. With
   * `editing.crossLane`, a drag or `Alt` and an arrow moves work between
   * resources. The unscheduled tasks beside it are `mountBacklog`.
   */
  readonly resources?: readonly Resource[] | undefined;
  readonly resourceOptions?: TimelineResourceOptions<T> | undefined;
  /**
   * The initial view. Without one, the items' extent plus a margin; without
   * items either, the month around the moment the timeline was created.
   */
  readonly domain?: readonly [TimeInput, TimeInput] | undefined;
  /** How far the reader can pan and zoom: the earliest and latest time, the shortest and longest span. */
  readonly limits?: DomainLimits | undefined;
  /** `"horizontal"`, `"vertical"`, or `"auto"` — vertical below `breakpoint`. Horizontal by default. */
  readonly orientation?: OrientationSetting | undefined;
  /** Width below which `orientation: "auto"` turns vertical. */
  readonly breakpoint?: number | undefined;
  /** `"comfortable"`, `"compact"`, `"dense"`, or `"auto"` — the one the visible items have room for. */
  readonly density?: DensitySetting | undefined;
  /**
   * Sizes over the density's: a row's height, the type, the corners, the
   * font — `{ rowSize: 36, fontSize: 14, fontFamily: "Inter, sans-serif" }`,
   * or a function of the level's own. Configuration rather than CSS: the
   * layout is measured with them.
   */
  readonly metrics?: MetricsSetting | undefined;
  /** How overlapping items share a lane: `"pack"` into rows (the default), `"overlap"`, or `"single"` row. */
  readonly packMode?: PackMode | undefined;
  /** `"light"`, `"dark"`, `"auto"` (the reader's color scheme), or a theme of your own. */
  readonly theme?: ThemeSetting | undefined;
  /** The language of the axis, the dates and the words, as a BCP 47 tag. `"en"` by default. */
  readonly locale?: string | undefined;
  /** The IANA time zone the axis and the dates are in. UTC by default. */
  readonly timeZone?: string | undefined;
  /**
   * The axis labels' text. The default writes years as ISO does (`-0500`
   * for 501 BC); a chronology writes its own.
   */
  readonly formatTick?: ((tick: Tick, timeZone: string) => string) | undefined;
  /**
   * The month (or year, or day) the view is in, held at the start of the
   * axis — `formatTick` writes it too, told by `tick.context`. On by
   * default; `false` leaves the axis to its ticks.
   */
  readonly axisContext?: boolean | undefined;
  /**
   * Whether the timeline claims every touch gesture (`own`, the default) or
   * leaves the page's vertical scroll to the page (`cooperative`) — for a
   * timeline embedded in an article, which a reader has to be able to
   * scroll past.
   */
  readonly touchAction?: TouchActionMode | undefined;
  /** Ceiling on drawn item labels. */
  readonly maxLabels?: number | undefined;
  /**
   * A label longer than its room: shortened with an ellipsis (`"ellipsis"`,
   * the default) or given up (`"drop"`). The full text stays the item's
   * accessible name either way.
   */
  readonly labelOverflow?: LabelOverflow | undefined;
  /** The accessible name of the listbox. */
  readonly ariaLabel?: string | undefined;
  /** What is drawn besides the items: banding of the periods, the now line, eras, markers. */
  readonly decorations?: readonly Decoration[] | undefined;
  /** Join items too close to tell apart into one cluster the reader opens; `true`, or the gap and size it joins at. */
  readonly cluster?: boolean | ClusterOptions | undefined;
  readonly hooks?: RenderHooks<T> | undefined;
  /**
   * The drawing's height in CSS pixels. Without one, the container's own
   * height when it has one (a stylesheet set it), else {@link DEFAULT_HEIGHT}
   * — for a vertical timeline as much as for a horizontal one.
   */
  readonly height?: number | undefined;
  /** Pointer tuning. Read when the timeline is created and on `update()`. */
  readonly interactions?: InteractionOptions | undefined;
  readonly editing?: TimelineEditingOptions<T> | undefined;
  /** The selection, when the host owns it. Changes from the user are still reported. */
  readonly selectedIds?: readonly string[] | undefined;
  /**
   * Scope for the embedded stylesheet and the drawing's ids, for a timeline
   * in the light DOM next to another. Without one, `createTimeline` in the
   * light DOM takes a scope of its own (`tl-auto1`, …), and a drawing taken
   * over from the server keeps the server's. The custom element does not
   * need one: its shadow root is the scope.
   */
  readonly instanceId?: string | undefined;
  /**
   * Width of a line of label text. In a browser the instance measures with
   * the page's own font; the server, which has no font, estimates — and the
   * first client frame patches the labels that came out differently.
   */
  readonly measureText?: MeasureText | undefined;
  /**
   * Draw the items in a stable space, mapped onto the view with one
   * transform per layer (`planSceneSpace`), so that a pan or a zoom frame
   * inside what is already drawn rewrites nothing but the transform. It is
   * what keeps a pan of 2000 visible items at 60 frames a second.
   *
   * The price: during a gesture the picture may be stretched by up to 1.5x,
   * and labels are those each sixteenth of a view could place. When the
   * gesture ends the frame is exact again, labels included: it shows every
   * label an exact frame would.
   *
   * `"auto"` (the default) and `true` draw in a space; `false` draws every
   * frame exact. Before 1.0.0-rc.2 `"auto"` drew exact below 1000 items,
   * because a space at rest could drop a label an exact frame keeps.
   */
  readonly sceneSpace?: boolean | "auto" | undefined;
  /**
   * Time the axis does not draw — nights, weekends, a shutdown: fixed and
   * repeating ranges (`createHiddenDates`), repeated in `timeZone`. A pan
   * moves by shown time and a zoom holds the instant under the pointer
   * across a hidden stretch; frames with hidden dates are drawn exactly.
   */
  readonly hiddenDates?: readonly HiddenDateRange[] | undefined;
  /**
   * The host's own lines across the timeline. Each is a slider: drag it, or
   * focus it with `Tab` and move it with an arrow (`PageUp`/`PageDown` ten
   * steps, `Home`/`End` to the view's ends). A move is `timeBarMoved`; the
   * instance keeps the bar where it was put until `timeBars` changes.
   */
  readonly timeBars?: readonly TimeBar[] | undefined;
  readonly timeBarOptions?: TimelineTimeBarOptions | undefined;
  /**
   * Follow the clock: the window keeps its span and keeps now at `offset`
   * (the middle by default), re-read every `intervalMs`. A pan or a zoom of
   * the reader's lets go of it until `follow()`.
   */
  readonly rolling?: boolean | TimelineRollingOptions | undefined;
  /** Buttons for named zooms — `true` for a day, a week, a month and a year — and `zoomToPreset(id)`. */
  readonly zoomPresets?: boolean | readonly ZoomPreset[] | undefined;
  /**
   * The overview strip along the far edge: the whole extent, with the view
   * as a window to drag, press beside, or focus and move with an arrow.
   */
  readonly minimap?: boolean | { readonly size?: number } | undefined;
  /**
   * Range selection: a drag along the axis band selects a stretch of time
   * instead of panning; with the timeline focused, `r` starts one at the
   * middle of the view, an arrow along the axis moves its end, `Enter`
   * selects and `Escape` lets go. Either is `rangeSelected`.
   */
  readonly rangeSelect?: boolean | (RangeSelectOptions & { readonly stepMs?: number }) | undefined;
  /** Each lane's name held at the start of the view while it is in view. */
  readonly laneHeaders?: boolean | undefined;
  /**
   * A tooltip on an item — on hover, on keyboard focus, and on a long press —
   * that the pointer can move onto and `Escape` dismisses (WCAG 1.4.13). Its
   * text is the item's label and dates, or what the function returns.
   */
  readonly tooltip?: (boolean | ((item: Item<T>) => string | null)) | undefined;
  /**
   * Which way the inline axis runs. `"rtl"` mirrors the timeline: time flows
   * from the right — vertically, the first lane is the rightmost — the
   * pointer, the wheel and the left and right arrows follow the mirror, and
   * text is laid out right to left. `"auto"` takes the element's computed
   * `direction` (the page's `dir`); a server, which has none, draws `"ltr"`.
   * Left to right by default.
   */
  readonly direction?: Direction | "auto" | undefined;
  /**
   * The library's words in the host's language: any phrases of
   * `DEFAULT_STRINGS` (`/intl`) — the accessible names of items, clusters,
   * tasks and loads, the tools' labels and announcements, a new item's
   * label. Dates and numbers are `Intl`'s, in `locale`. Without it, the
   * English the library has always said.
   */
  readonly strings?: Partial<Strings> | undefined;
  /**
   * A calendar `Intl` knows — `"hebrew"`, `"islamic-umalqura"`,
   * `"persian"`, `"chinese"`, `"japanese"`, `"buddhist"`, … The axis's
   * months and years are then the calendar's own, and its labels `Intl`'s
   * in `locale` (`formatTick` still wins). `"gregory"` keeps the Gregorian
   * axis with `Intl` labels. Without one the axis is Gregorian and its labels
   * the deterministic default.
   */
  readonly calendar?: string | undefined;
}

/** How a time bar moves. */
export interface TimelineTimeBarOptions {
  /** A key's step. A hundredth of the view by default, on the snap grid. */
  readonly stepMs?: number | undefined;
  /** The grid a moved bar lands on. */
  readonly snapMs?: number | undefined;
}

/** How the window follows the clock. */
export interface TimelineRollingOptions extends RollingOptions {
  /** How often the clock is read. A second by default. */
  readonly intervalMs?: number | undefined;
}

/** Whether frames are drawn in a space. */
export function usesSceneSpace<T>(config: TimelineConfig<T>): boolean {
  // The renderer draws hidden dates exactly: a space is linear time.
  return config.sceneSpace !== false && (config.hiddenDates === undefined || config.hiddenDates.length === 0);
}

/**
 * A change to a configuration. A key present with `undefined` goes back to
 * its default; an absent key keeps its value.
 */
export type TimelineUpdate<T = unknown> = { readonly [K in keyof TimelineConfig<T>]?: TimelineConfig<T>[K] | undefined };

/**
 * A framework component's configuration: every {@link TimelineConfig} field,
 * except that the view and the selection are where they *start*. A
 * component re-renders with its props; a `domain` prop written back from
 * `viewportChanged` would move the view under the reader's pointer, so the
 * view is moved by the instance's `zoomTo`, and the selection by its
 * `select`, once the component is up.
 */
export interface TimelineComponentConfig<T = unknown> extends Omit<TimelineConfig<T>, "domain" | "selectedIds"> {
  /** The visible range the timeline starts with. */
  readonly defaultDomain?: readonly [TimeInput, TimeInput] | undefined;
  /** The selection the timeline starts with. */
  readonly defaultSelectedIds?: readonly string[] | undefined;
}

const isPlain = (value: object): value is Record<string, unknown> => {
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
};

/**
 * Whether two configuration values say the same: one value, or plain
 * objects and arrays whose entries say the same, or dates at one time. A
 * host that writes `editing={{ enabled: true }}` into its render hands over
 * a new object each time with nothing new in it.
 */
export function sameValue(a: unknown, b: unknown, depth = 4): boolean {
  if (Object.is(a, b)) return true;
  if (depth === 0 || typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (a instanceof Date) return b instanceof Date && a.getTime() === b.getTime();
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((each, index) => sameValue(each, b[index], depth - 1));
  if (Array.isArray(b) || !isPlain(a) || !isPlain(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && sameValue(a[key], b[key], depth - 1));
}

/** Height when neither the configuration nor the container says. */
export const DEFAULT_HEIGHT = 300;
/** Width the server draws at: it cannot measure the container. */
export const DEFAULT_SERVER_WIDTH = 960;

const DAY = 86_400_000;

/** What the view resolved to for one container size. */
export interface ResolvedView {
  readonly width: number;
  readonly height: number;
  readonly orientation: Orientation;
  readonly density: Density;
  /** The container's extent along the time axis. */
  readonly mainSize: number;
  /** The frame's extent across the lanes: the container's, less the overview strip. */
  readonly crossSize: number;
  /** The overview strip's thickness; 0 without one. */
  readonly band: number;
  /** The sizes the view draws with, when the configuration sets any (`config.metrics`). */
  readonly metrics?: MetricsProvider | undefined;
}

/** The overview strip's thickness for a configuration; 0 without one. */
export function minimapSize<T>(config: TimelineConfig<T>): number {
  const setting = config.minimap;
  if (setting === undefined || setting === false) return 0;
  const size = plugin("tools", "The minimap option").minimapSize;
  return setting === true ? size : (setting.size ?? size);
}

const hiddenCache = new WeakMap<readonly HiddenDateRange[], Map<string, HiddenDates>>();

/** The hidden dates of a configuration: one object per ranges array and zone, which keeps what it expanded. */
export function hiddenDatesOf<T>(config: TimelineConfig<T>): HiddenDates | undefined {
  const ranges = config.hiddenDates;
  if (ranges === undefined || ranges.length === 0) return undefined;
  const zone = config.timeZone ?? "UTC";
  let byZone = hiddenCache.get(ranges);
  if (byZone === undefined) {
    byZone = new Map();
    hiddenCache.set(ranges, byZone);
  }
  let hidden = byZone.get(zone);
  if (hidden === undefined) {
    hidden = plugin("tools", "The hiddenDates option").hidden(ranges, zone);
    byZone.set(zone, hidden);
  }
  return hidden;
}

/** `inputSkipped`: an item or an option the timeline cannot read, left out so the rest is drawn. */
export interface InputSkippedPayload {
  /** What was wrong, for a developer. */
  readonly message: string;
  /** The item left out, as it was given. */
  readonly item?: unknown;
  /** The option that fell back to its default. */
  readonly option?: "locale" | "timeZone";
}

/** Where a skipped item or option is said. */
export type SkipReport = (skipped: InputSkippedPayload) => void;

/** A time the core reads: epoch milliseconds or a `Date`, within the `Date` range. */
function isTime(value: unknown): boolean {
  const ms = typeof value === "number" ? value : typeof (value as Date | null)?.getTime === "function" ? (value as Date).getTime() : Number.NaN;
  return Math.abs(ms) <= 8.64e15;
}

/** Why an item cannot be drawn, or `undefined` when it can. */
function itemProblem(item: unknown): string | undefined {
  if (typeof item !== "object" || item === null) return `An item that is not an object (${String(item)}) is left out`;
  const { id, start, end, sublaneSpan } = item as Partial<Item>;
  if (typeof id !== "string") return "An item without a string id is left out";
  const which = `Item ${JSON.stringify(id)}`;
  const time = "epoch milliseconds or a Date, within ±8.64e15";
  if (!isTime(start)) return `${which} is left out: its start (${String(start)}) is not a time — ${time}`;
  if (end !== undefined && !isTime(end)) return `${which} is left out: its end (${String(end)}) is not a time — ${time}`;
  if (sublaneSpan !== undefined && !(Number.isInteger(sublaneSpan) && sublaneSpan >= 1)) return `${which} is left out: its sublaneSpan (${String(sublaneSpan)}) is not a positive integer`;
  return undefined;
}

/** Each items array checked once: what is kept, and what was left out. */
const checkedItems = new WeakMap<readonly unknown[], { readonly kept: readonly unknown[]; readonly skipped: readonly InputSkippedPayload[] }>();

/**
 * The items the timeline can draw: the array itself when every item is
 * readable, a shorter one otherwise, each left-out item said to `report`.
 * An item from an attribute, a JSON script or a fetched window can be
 * anything, and one bad item must not take the whole frame.
 */
export function readableItems<T>(items: readonly Item<T>[], report?: SkipReport): readonly Item<T>[] {
  let checked = checkedItems.get(items);
  if (checked === undefined) {
    let kept: unknown[] | undefined;
    const skipped: InputSkippedPayload[] = [];
    items.forEach((item, index) => {
      const problem = itemProblem(item);
      if (problem === undefined) kept?.push(item);
      else {
        kept ??= items.slice(0, index);
        skipped.push({ message: problem, item });
      }
    });
    checked = { kept: kept ?? items, skipped };
    checkedItems.set(items, checked);
  }
  if (report !== undefined) for (const each of checked.skipped) report(each);
  return checked.kept as readonly Item<T>[];
}

/** The items a configuration shows right away: none for a fetched source, and only those it can draw. */
export function itemsOf<T>(config: TimelineConfig<T>, report?: SkipReport): readonly Item<T>[] {
  return typeof config.items === "function" ? [] : readableItems(config.items ?? [], report);
}

const readableOptions = new Map<string, boolean>();

/** Whether the platform reads a locale or a time zone: `Intl` throws on one it does not. */
function readable(key: string, probe: () => unknown): boolean {
  let known = readableOptions.get(key);
  if (known === undefined) {
    try {
      probe();
      known = true;
    } catch {
      known = false;
    }
    if (readableOptions.size >= 64) readableOptions.clear();
    readableOptions.set(key, known);
  }
  return known;
}

/**
 * The configuration without a `locale` or `timeZone` the platform cannot
 * read — each falls back to its default, and is said to `report`. The same
 * object when both are fine.
 */
export function readableOptionsOf<T>(config: TimelineConfig<T>, report?: SkipReport): TimelineConfig<T> {
  const { locale, timeZone } = config;
  const badLocale = locale !== undefined && !readable(`l${locale}`, () => Intl.getCanonicalLocales(locale));
  const badZone = timeZone !== undefined && !readable(`z${timeZone}`, () => new Intl.DateTimeFormat("en", { timeZone }));
  if (!badLocale && !badZone) return config;
  const kept: Record<string, unknown> = { ...config };
  if (badLocale) {
    delete kept.locale;
    report?.({ message: `The locale ${JSON.stringify(locale)} is not a language tag the platform reads; the default is used`, option: "locale" });
  }
  if (badZone) {
    delete kept.timeZone;
    report?.({ message: `The time zone ${JSON.stringify(timeZone)} is not one the platform knows; UTC is used`, option: "timeZone" });
  }
  return kept as TimelineConfig<T>;
}

/**
 * The domain a configuration starts at.
 *
 * Given one, that one. Otherwise the items' extent with a twentieth of a
 * margin on each side, so nothing starts on the edge. `now` is only read
 * when there is nothing else to go by, which is also the only case where a
 * server and a client could disagree — and the server writes the domain it
 * chose into its markup, so the client does not have to guess.
 */
export function initialDomain<T>(config: TimelineConfig<T>, now: () => TimeMs = Date.now): readonly [TimeMs, TimeMs] {
  if (config.domain !== undefined) {
    return [toTimeMs(config.domain[0]), toTimeMs(config.domain[1])];
  }
  let min = Infinity;
  let max = -Infinity;
  for (const item of itemsOf(config)) {
    const start = toTimeMs(item.start);
    const end = item.end === undefined ? start : toTimeMs(item.end);
    min = Math.min(min, start);
    max = Math.max(max, end);
  }
  if (min === Infinity) {
    const at = now();
    return [at - 15 * DAY, at + 15 * DAY];
  }
  const margin = Math.max((max - min) / 20, DAY);
  return [min - margin, max + margin];
}

/**
 * Orientation, density and extents for a container size.
 *
 * `previous` is what is on screen, which is what lets the core's hysteresis
 * keep a timeline from flipping back and forth at a breakpoint.
 */
export function resolveView<T>(
  config: TimelineConfig<T>,
  items: readonly Item<T>[],
  domain: readonly [TimeMs, TimeMs],
  width: number,
  measuredHeight: number,
  previous?: { readonly orientation: Orientation; readonly density: Density },
  state?: Pick<FrameState<T>, "groups" | "collapsed">,
): ResolvedView {
  // The rows the density has to fit are the frame's: the groups' header and
  // content lanes, the items a collapsed group leaves shown.
  const content = contentOf(config, { items, ...state });
  const orientation = resolveOrientation(config.orientation, width, {
    ...(config.breakpoint === undefined ? {} : { breakpoint: config.breakpoint }),
    ...(previous === undefined ? {} : { previous: previous.orientation }),
  });
  const height = config.height ?? (measuredHeight > 0 ? measuredHeight : DEFAULT_HEIGHT);
  // The strip takes its thickness from the frame, across the lanes.
  const band = minimapSize(config);
  const density = resolveDensity(
    config.density,
    fitDensity({
      items: content.items,
      ...(content.lanes === undefined ? {} : { lanes: content.lanes }),
      ...(config.packMode === undefined ? {} : { packMode: config.packMode }),
      ...(config.timeZone === undefined ? {} : { timeZone: config.timeZone }),
      domain,
      width: orientation === "vertical" ? Math.max(width - band, 0) : width,
      height: orientation === "horizontal" ? Math.max(height - band, 0) : height,
      orientation,
      ...(previous === undefined || previous.orientation !== orientation ? {} : { previous: previous.density }),
      ...(config.metrics === undefined ? {} : { metrics: metricsProviderOf(config.metrics) as MetricsProvider }),
    }),
  );
  return {
    width,
    height,
    orientation,
    density,
    mainSize: orientation === "horizontal" ? width : height,
    crossSize: Math.max((orientation === "horizontal" ? height : width) - band, 0),
    band,
    ...(config.metrics === undefined ? {} : { metrics: metricsProviderOf(config.metrics) }),
  };
}

/** The live state a frame depends on beyond the configuration. */
export interface FrameState<T> {
  readonly items: readonly Item<T>[];
  readonly domain: readonly [TimeMs, TimeMs];
  readonly view: ResolvedView;
  readonly selectedIds: readonly string[];
  readonly focusedId: string | null;
  readonly crossOffset: number;
  readonly loading: readonly LoadingRange[];
  readonly measureText?: MeasureText;
  /** The space the items are drawn in ({@link initialSpace} for the first frame). */
  readonly space?: SceneSpace;
  /** The groups as reordered on screen. `config.groups` by default. */
  readonly groups?: readonly Group[];
  /** The collapsed groups. Each group's own `collapsed` by default. */
  readonly collapsed?: ReadonlySet<string>;
  /** The layout of the frame's items when it is already known — after a live change, `relayout`'s. */
  readonly layout?: Layout<T>;
  /** The direction the frame is drawn in, `"auto"` resolved. {@link directionOf} without it. */
  readonly direction?: Direction;
  /** Drawn in a shadow root: the tokens on `:host` (`RenderOptions.host`). An export is not. */
  readonly host?: boolean;
}

/** The direction a frame is drawn in: the state's, or the configuration's with `"auto"` as `"ltr"`. */
export function directionOf<T>(config: TimelineConfig<T>, state?: Pick<FrameState<T>, "direction">): Direction {
  return state?.direction ?? (config.direction === "rtl" ? "rtl" : "ltr");
}

/** The words of a configuration. */
export interface Words {
  readonly strings: Strings;
  readonly say: (key: keyof Strings, values?: Readonly<Record<string, string | number>>) => string;
}

const wordCache = new WeakMap<object, Map<string, Words>>();
const NO_STRINGS = {};

/**
 * The dictionary and its `say`, in the configuration's locale: one object
 * while neither changes. The English defaults without `strings`.
 */
export function wordsOf<T>(config: Pick<TimelineConfig<T>, "strings" | "locale">): Words {
  const key = config.strings ?? NO_STRINGS;
  let byLocale = wordCache.get(key);
  if (byLocale === undefined) wordCache.set(key, (byLocale = new Map()));
  const locale = config.locale ?? "en";
  let words = byLocale.get(locale);
  if (words === undefined) {
    const strings = resolveStrings(config.strings);
    words = { strings, say: sayIn(strings, locale) };
    byLocale.set(locale, words);
  }
  return words;
}

const viewCache = new WeakMap<readonly unknown[], { groups: readonly Group[]; collapsed: ReadonlySet<string> | undefined; view: GroupView<unknown> }>();
const splitCache = new WeakMap<readonly unknown[], SplitItems<unknown>>();
const NO_HOOKS: RenderHooks<unknown> = {};

/**
 * The groups' lanes and the items they leave shown — kept per items array:
 * the renderer caches its layout and its tiles by the array's identity, so a
 * new array every frame would be a full redraw every frame.
 */
export function groupViewOf<T>(groups: readonly Group[], items: readonly Item<T>[], collapsed?: ReadonlySet<string>): GroupView<T> {
  const hit = viewCache.get(items);
  if (hit !== undefined && hit.groups === groups && hit.collapsed === collapsed) return hit.view as GroupView<T>;
  const view = plugin("groups", "The groups option").groupView(groups, items, collapsed === undefined ? {} : { collapsed });
  viewCache.set(items, { groups, collapsed, view: view as GroupView<unknown> });
  return view;
}

/**
 * The items a frame packs and the backgrounds it draws, kept per items array.
 * Without the `/items` plugin every item is packed — and an item of a kind
 * only the plugin draws is an error, here for a fetched source's.
 */
function splitOf<T>(items: readonly Item<T>[], timeZone: string | undefined): SplitItems<T> {
  let split = splitCache.get(items);
  if (split === undefined) {
    const feature = pluginIf("items");
    if (feature === undefined) requireKinds(items);
    split = feature === undefined ? { items, backgrounds: [] } : feature.split(items as readonly Item<unknown>[], timeZone);
    splitCache.set(items, split);
  }
  return split as SplitItems<T>;
}

/**
 * Throw now, where a configuration was given, for sizes nothing can be
 * drawn at — not later, inside a frame the browser draws.
 */
export function checkMetrics<T>(config: Pick<TimelineConfig<T>, "metrics">): void {
  metricsProviderOf(config.metrics)?.("comfortable", "horizontal");
}

/**
 * The sizes a host sets over its density's: a row's height, the type, the
 * corners, the font (`config.metrics`).
 *
 * Sizes are configuration, not CSS, for the reason the stylesheet is
 * generated: the layout packs rows of `rowSize` and places labels it
 * measured in `fontSize` and `fontFamily`, so a type size or a font set in a
 * stylesheet would draw text into room that was measured for other text.
 * The thresholds of `density: "auto"` and the smallest item stay the level's.
 */
export interface SizeOverrides {
  readonly rowSize?: number;
  readonly rowGap?: number;
  readonly laneGap?: number;
  readonly fontSize?: number;
  readonly tickFontSize?: number;
  readonly lineHeight?: number;
  readonly labelPadding?: number;
  readonly axisSize?: number;
  readonly cornerRadius?: number;
  /** A CSS font stack. The font has to be loaded before the timeline measures with it. */
  readonly fontFamily?: string;
}

/**
 * Sizes over the density's: the same for every level and orientation, or a
 * function of the level's own (`(base) => ({ rowSize: base.rowSize + 8 })`),
 * which is how a host keeps the three levels apart, or a row and a column.
 */
export type MetricsSetting = SizeOverrides | ((base: DensityMetrics) => SizeOverrides);

/** What a host may set; the thresholds and the level itself stay the table's. */
const SIZE_KEYS = ["rowSize", "rowGap", "laneGap", "fontSize", "tickFontSize", "lineHeight", "labelPadding", "axisSize", "cornerRadius", "fontFamily"] as const;
/** Sizes nothing can be drawn at when they are zero. */
const POSITIVE: ReadonlySet<string> = new Set(["rowSize", "fontSize", "tickFontSize", "lineHeight"]);
/** What would end the stylesheet's rule the font stack is written into. */
const UNSAFE_FONT = /[;{}<>\\]|\/\*/;

function overridden(base: DensityMetrics, setting: MetricsSetting): DensityMetrics {
  const sizes = typeof setting === "function" ? setting(base) : setting;
  const out: Record<string, unknown> = { ...base };
  for (const key of SIZE_KEYS) {
    const value: unknown = sizes[key];
    if (value === undefined) continue;
    const font = key === "fontFamily";
    const ok = font
      ? typeof value === "string" && value.trim() !== "" && !UNSAFE_FONT.test(value)
      : typeof value === "number" && Number.isFinite(value) && (POSITIVE.has(key) ? value > 0 : value >= 0);
    if (!ok) {
      const what = font ? "a CSS font stack" : POSITIVE.has(key) ? "a positive number of pixels" : "a non-negative number of pixels";
      throw new RangeError(`metrics.${key} must be ${what}, got ${JSON.stringify(value) ?? String(value)}`);
    }
    out[key] = value;
  }
  return out as unknown as DensityMetrics;
}

const providers = new WeakMap<object, MetricsProvider>();

/**
 * A configuration's sizes as the renderer reads them: one object per level
 * and orientation, made once — a frame asks for its sizes in many places,
 * and a function setting is called once for each.
 */
export function metricsProviderOf(setting: MetricsSetting | undefined): MetricsProvider | undefined {
  if (setting === undefined) return undefined;
  let provider = providers.get(setting);
  if (provider === undefined) {
    const made = new Map<string, DensityMetrics>();
    provider = (density, orientation) => {
      const key = `${density}|${orientation}`;
      let metrics = made.get(key);
      if (metrics === undefined) {
        metrics = overridden(densityMetrics(density, orientation), setting);
        made.set(key, metrics);
      }
      return metrics;
    };
    providers.set(setting, provider);
  }
  return provider;
}

/** The sizes a view draws with: its density's, with the configuration's over them. */
export function sizesOf(view: Pick<ResolvedView, "density" | "orientation" | "metrics">): DensityMetrics {
  return (view.metrics ?? densityMetrics)(view.density, view.orientation);
}

/** Whether a configuration draws slots. */
export function slotsOn<T>(config: Pick<TimelineConfig<T>, "slots">): boolean {
  return config.slots !== undefined && config.slots !== false;
}

/** The render hooks: the host's — under a template and the item kinds with the `/items` plugin. */
function hooksOf<T>(config: TimelineConfig<T>): RenderHooks<T> {
  const base = (config.hooks ?? NO_HOOKS) as RenderHooks<T>;
  const feature =
    config.template !== undefined ? plugin("items", "The template option") : slotsOn(config) ? plugin("items", "The slots option") : pluginIf("items");
  return feature === undefined ? base : feature.hooks(config, base);
}

const wordHookCache = new WeakMap<
  RenderHooks<unknown>,
  { readonly words: Words; readonly timeZone: string | undefined; readonly lanes: readonly Lane[] | undefined; readonly hooks: RenderHooks<unknown> }
>();

/**
 * Item and cluster names in the configuration's words, under whatever names
 * the host gave — only with `strings`: without them the core's own English,
 * as ever. One object while nothing it reads changes.
 */
function wordHooksOf<T>(config: TimelineConfig<T>, hooks: RenderHooks<T>, lanes: readonly Lane[] | undefined): RenderHooks<T> {
  if (config.strings === undefined) return hooks;
  const words = wordsOf(config);
  const hit = wordHookCache.get(hooks as RenderHooks<unknown>);
  if (hit !== undefined && hit.words === words && hit.timeZone === config.timeZone && hit.lanes === lanes) return hit.hooks as RenderHooks<T>;
  const named = plugin("intl", "The strings option").describeHooks<T>({
    strings: words.strings,
    ...(config.locale === undefined ? {} : { locale: config.locale }),
    ...(config.timeZone === undefined ? {} : { timeZone: config.timeZone }),
    ...(lanes === undefined ? {} : { lanes: new Map(lanes.map((lane) => [lane.id, lane.label])) }),
  });
  const wrapped: RenderHooks<T> = {
    ...hooks,
    describeItem: hooks.describeItem ?? named.describeItem,
    describeCluster: hooks.describeCluster ?? named.describeCluster,
  };
  wordHookCache.set(hooks as RenderHooks<unknown>, { words, timeZone: config.timeZone, lanes, hooks: wrapped as RenderHooks<unknown> });
  return wrapped;
}

/** What the layout sees of a frame's items and lanes: groups and backgrounds resolved. */
export function contentOf<T>(
  config: TimelineConfig<T>,
  state: Pick<FrameState<T>, "items" | "groups" | "collapsed">,
): { readonly items: readonly Item<T>[]; readonly lanes: readonly Lane[] | undefined; readonly decorations: readonly Decoration[] | undefined; readonly view: GroupView<T> | undefined } {
  const groups = state.groups ?? config.groups;
  const view = groups === undefined ? undefined : groupViewOf(groups, state.items, state.collapsed);
  const split = splitOf(view === undefined ? state.items : view.items, config.timeZone);
  const decorations =
    split.backgrounds.length === 0
      ? config.decorations
      : [...split.backgrounds, ...(config.decorations ?? [])];
  return { items: split.items, lanes: lanesOf(config, view === undefined ? config.lanes : view.lanes), decorations, view };
}

/** The lanes with the resources', for a resource view (`/resources`). */
function lanesOf<T>(config: TimelineConfig<T>, lanes: readonly Lane[] | undefined): readonly Lane[] | undefined {
  return config.resources === undefined ? lanes : plugin("resources", "The resources option").lanes(config, lanes);
}

/** The hooks a frame draws with: the host's and the configuration's, then the Gantt chart's and the resource view's over them. */
function frameHooksOf<T>(config: TimelineConfig<T>, state: FrameState<T>, content: ReturnType<typeof contentOf<T>>): RenderHooks<T> {
  let hooks = wordHooksOf(config, hooksOf(config), content.lanes);
  if (config.gantt !== undefined) hooks = plugin("gantt", "The gantt option").hooks(config, hooks, content.items, content.lanes);
  if (config.resources !== undefined) hooks = plugin("resources", "The resources option").hooks(config, hooks, state.items, content.lanes);
  return hooks;
}

const calendarCache = new Map<string, { readonly hidden: HiddenDates | undefined; readonly ticks: NonNullable<RenderOptions<unknown>["ticks"]> }[]>();
const labelCache = new Map<string, (tick: Tick, timeZone: string) => string>();

/**
 * The axis's ticks and labels: the host's `formatTick`, and with a
 * `calendar` its months and years, labelled by `Intl` in `locale`. One
 * function per calendar, locale and hidden dates, so the renderer's caches
 * see the same options frame after frame.
 */
function tickOptionsOf<T>(config: TimelineConfig<T>, hidden: HiddenDates | undefined): Pick<RenderOptions<T>, "ticks" | "formatTick"> {
  const calendar = config.calendar;
  if (calendar === undefined) return config.formatTick === undefined ? {} : { formatTick: config.formatTick };
  let kept = calendarCache.get(calendar);
  if (kept === undefined) calendarCache.set(calendar, (kept = []));
  let entry = kept.find((each) => each.hidden === hidden);
  if (entry === undefined) {
    entry = { hidden, ticks: plugin("intl", "The calendar option").calendarTicks(calendar, hidden === undefined ? {} : { hidden }) };
    kept.push(entry);
    if (kept.length > 8) kept.shift();
  }
  const key = `${config.locale ?? "en"}\u0000${calendar}`;
  let label = labelCache.get(key);
  if (label === undefined) labelCache.set(key, (label = plugin("intl", "The calendar option").calendarTickLabel(config.locale ?? "en", calendar)));
  return { ticks: entry.ticks, formatTick: config.formatTick ?? label };
}

/** The renderer's options for one frame. The server calls this too. */
export function frameOptions<T>(config: TimelineConfig<T>, state: FrameState<T>): RenderOptions<T> {
  const measureText = config.measureText ?? state.measureText;
  const hidden = hiddenDatesOf(config);
  const content = contentOf(config, state);
  return {
    items: content.items,
    ...(content.lanes === undefined ? {} : { lanes: content.lanes }),
    domain: state.domain,
    // The frame, without the overview strip across its far edge.
    width: state.view.orientation === "vertical" ? Math.max(state.view.width - state.view.band, 0) : state.view.width,
    height: state.view.orientation === "horizontal" ? Math.max(state.view.height - state.view.band, 0) : state.view.height,
    orientation: state.view.orientation,
    density: state.view.density,
    ...(state.view.metrics === undefined ? {} : { metrics: state.view.metrics }),
    ...(config.theme === undefined ? {} : { theme: config.theme }),
    ...(config.packMode === undefined ? {} : { packMode: config.packMode }),
    ...(config.timeZone === undefined ? {} : { timeZone: config.timeZone }),
    ...(config.locale === undefined ? {} : { locale: config.locale }),
    ...tickOptionsOf(config, hidden),
    ...(config.axisContext === false ? { axisContext: false } : {}),
    ...(config.touchAction === undefined ? {} : { touchAction: config.touchAction }),
    ...(config.maxLabels === undefined ? {} : { maxLabels: config.maxLabels }),
    ...(config.labelOverflow === undefined ? {} : { labelOverflow: config.labelOverflow }),
    ...(config.ariaLabel === undefined ? (config.strings === undefined ? {} : { ariaLabel: wordsOf(config).say("timeline") }) : { ariaLabel: config.ariaLabel }),
    ...(content.decorations === undefined ? {} : { decorations: content.decorations }),
    ...(config.cluster === undefined ? {} : { cluster: config.cluster }),
    hooks: frameHooksOf(config, state, content),
    ...(config.instanceId === undefined ? {} : { instanceId: config.instanceId }),
    ...(measureText === undefined ? {} : { measureText }),
    ...(config.editing?.multiSelect === undefined ? {} : { multiSelect: config.editing.multiSelect }),
    selectedIds: state.selectedIds,
    focusedId: state.focusedId,
    crossOffset: state.crossOffset,
    loading: state.loading,
    ...(state.space === undefined ? {} : { space: state.space }),
    ...(hidden === undefined ? {} : { hiddenDates: hidden }),
    ...(state.layout === undefined ? {} : { layout: state.layout }),
  };
}

/**
 * The space the first frame is drawn in — on the server and in the client
 * alike, so the client's first frame is the server's, node for node. It is
 * anchored at the view and draws the view only; a client at rest then grows
 * it into the overscan a strip per frame (`planSceneSpace`).
 */
export function initialSpace(domain: readonly [TimeMs, TimeMs], view: ResolvedView): SceneSpace {
  return planSceneSpace(undefined, { domain, mainSize: view.mainSize }, { settle: true });
}

/**
 * The theme an export is drawn with: the configured one, and for `auto` the
 * one the screen shows now — a standalone file must not change with the
 * scheme of whoever opens it.
 */
export function exportTheme(theme: ThemeSetting | undefined, win: Pick<Window, "matchMedia"> | null | undefined): ThemeSetting {
  if (theme !== undefined && theme !== "auto") return theme;
  return win?.matchMedia("(prefers-color-scheme: dark)").matches === true ? "dark" : "light";
}

/** The axis band and the smallest drawn item, for the hit tester and the navigator. */
export function metricsOf(view: ResolvedView): { readonly axisSize: number; readonly minItemMainSize: number } {
  const metrics = sizesOf(view);
  return { axisSize: metrics.axisSize, minItemMainSize: metrics.minItemMainSize };
}

/**
 * A layer last drawn — the arrows, or the load: its nodes, valid while the
 * frame (the layout, the scroll across, the selection), what it draws and
 * the scale are the same; and the nodes for the last clip, in that scale's
 * pixels. A pan in a space keeps the scale, so a layer once drawn is not
 * drawn again (P20, G-PERF-GANTT).
 */
interface LayerCache {
  readonly layout: Layout<unknown>;
  readonly data: object;
  readonly frame: string;
  readonly selectedIds: readonly string[];
  readonly origin: number;
  readonly msPerPx: number;
  /** Per-route paths, for the arrows. */
  readonly made: Map<string, string>;
  clip: readonly [number, number, number];
  nodes: readonly SceneElement[];
}

const layerCaches: { deps: LayerCache | undefined; load: LayerCache | undefined } = { deps: undefined, load: undefined };

/** A layer's scale: the frame's, or in a space the space's, whose pixels the items are drawn in. */
export function layerScale<T>(state: FrameState<T>): ReturnType<typeof createTimeScale> {
  const size = state.view.mainSize;
  const space = state.space;
  return space === undefined ? createTimeScale(state.domain, size) : createTimeScale([space.origin, space.origin + size * space.msPerPx], size);
}

/**
 * One layer's nodes for a frame, through its cache. On an exact frame they
 * are culled to the view; in a space, to the view and a quarter viewport
 * each way, in quarter viewports, so a pan step mostly reuses the same
 * nodes and writes nothing but the layer's transform. During a gesture that
 * re-anchors the space — a zoom — the nodes of the scale before stand in,
 * stretched onto the new one, as the renderer's tiles do, for as long as the
 * view stays in what they were drawn for; at rest they are drawn again,
 * exactly.
 */
export function layerNodes<T>(
  slot: "deps" | "load",
  data: object,
  state: FrameState<T>,
  result: RenderResult<T>,
  frame: string,
  draw: (scale: ReturnType<typeof createTimeScale>, clip: { readonly main: readonly [number, number]; readonly cross: readonly [number, number] }, made: Map<string, string>) => readonly SceneElement[],
): readonly SceneElement[] {
  const view = state.view;
  const metrics = sizesOf(view);
  const space = state.space;
  const size = view.mainSize;
  const scale = layerScale(state);
  const crossEnd = view.crossSize + metrics.rowSize;
  const start = toTimeMs(state.domain[0]);
  const end = toTimeMs(state.domain[1]);
  const key = [view.orientation, view.density, size, state.crossOffset, crossEnd, frame].join("|");
  let cache = layerCaches[slot];
  if (
    cache !== undefined &&
    cache.layout === result.layout &&
    cache.data === data &&
    cache.frame === key &&
    cache.selectedIds === state.selectedIds &&
    space !== undefined &&
    space.atRest !== true &&
    (cache.origin !== scale.domain[0] || cache.msPerPx !== scale.msPerPx)
  ) {
    // The view in the pixels the layer was drawn in.
    const from = (start - cache.origin) / cache.msPerPx;
    const to = (end - cache.origin) / cache.msPerPx;
    if (from >= cache.clip[0] && to <= cache.clip[1]) {
      const k = cache.msPerPx / scale.msPerPx;
      const shift = (cache.origin - scale.domain[0]) / scale.msPerPx;
      const transform =
        view.orientation === "horizontal" ? `matrix(${String(k)} 0 0 1 ${String(shift)} 0)` : `matrix(1 0 0 ${String(k)} 0 ${String(shift)})`;
      return [{ tag: "g", attrs: { transform }, children: cache.nodes }];
    }
  }
  if (
    cache === undefined ||
    cache.layout !== result.layout ||
    cache.data !== data ||
    cache.frame !== key ||
    cache.selectedIds !== state.selectedIds ||
    cache.origin !== scale.domain[0] ||
    cache.msPerPx !== scale.msPerPx
  ) {
    cache = {
      layout: result.layout as Layout<unknown>,
      data,
      frame: key,
      selectedIds: state.selectedIds,
      origin: scale.domain[0],
      msPerPx: scale.msPerPx,
      made: new Map(),
      clip: [Number.NaN, Number.NaN, Number.NaN],
      nodes: [],
    };
    layerCaches[slot] = cache;
  }
  // Without a space every frame has its own scale: the view and two rows.
  // In one, the view and a quarter viewport or more each way, in quarter
  // viewports — a viewport during a gesture, which a zoom out reaches into.
  // A gesture may stretch the space: the view is then wider or narrower in
  // it than the viewport.
  const margin = 2 * metrics.rowSize;
  const step = space?.atRest === true ? size / 4 : size;
  const from = scale.toMain(start);
  const to = scale.toMain(end);
  const main: readonly [number, number] =
    space === undefined ? [-margin, size + margin] : [(Math.floor(from / step) - 1) * step, (Math.ceil(to / step) + 1) * step];
  if (cache.clip[0] !== main[0] || cache.clip[1] !== main[1] || cache.clip[2] !== crossEnd) {
    cache.nodes = draw(scale, { main, cross: [metrics.axisSize, crossEnd] }, cache.made);
    cache.clip = [main[0], main[1], crossEnd];
  }
  return cache.nodes;
}

/** The control's clip: every lane, and all the time a drawing can hold. */
export const EVERYWHERE = { main: [-1e7, 1e7], cross: [-1e7, 1e7] } as const;

/**
 * The frame as drawn: the renderer's scene, plus — for a resource view — the
 * load in a layer under the items, and — for a Gantt chart — the dependency
 * arrows in a layer between the load and the items, both in the items' own
 * space and both drawn by their plugin. The live instance and the server
 * both draw through this, so a server-rendered frame holds the layers the
 * client's first frame would.
 */
export function frameScene<T>(config: TimelineConfig<T>, state: FrameState<T>, result: RenderResult<T>): SceneElement {
  const scene = layeredScene(config, state, result);
  // Last, over every layer: right to left is the whole frame's mirror image.
  const drawn = directionOf(config, state) === "rtl" ? plugin("intl", 'The direction "rtl" option').mirrorScene(scene) : scene;
  return state.host === true ? onHost(drawn) : drawn;
}

/** A token rule of the stylesheet: the root, scoped or not, and the dark scheme's guard. */
const TOKEN_RULE = /\.tl(?:\[data-tl-instance="[\w-]*"\])?(?::not\(\[data-tl-theme="light"\]\))?\{--tl-/g;
const hosted = new Map<string, string>();

/**
 * The frame in a shadow root: its stylesheet declares the tokens on `:host`.
 *
 * Custom properties inherit through a shadow boundary, but the stylesheet
 * declares the tokens on `.tl` inside it, and a declaration beats what is
 * inherited — so a page's `temporeum-timeline { --tl-item-fill: … }` would
 * reach the element and stop there. On `:host` they are the shadow root's
 * defaults, and a page's rule for the element wins over a `:host` rule by
 * the cascade, whatever its specificity. The rest of the stylesheet stays
 * on `.tl`. An export is drawn without this: in a file `:host` is nothing.
 */
function onHost(scene: SceneElement): SceneElement {
  const children = scene.children ?? [];
  const at = children.findIndex((child) => child.tag === "style");
  const style = children[at];
  if (style?.text === undefined) return scene;
  let text = hosted.get(style.text);
  if (text === undefined) {
    text = style.text.replace(TOKEN_RULE, ":host{--tl-");
    if (hosted.size >= 64) hosted.clear();
    hosted.set(style.text, text);
  }
  const next = [...children];
  next[at] = { ...style, text };
  return { ...scene, children: next };
}

function layeredScene<T>(config: TimelineConfig<T>, state: FrameState<T>, result: RenderResult<T>): SceneElement {
  let scene = result.scene;
  if (config.resources !== undefined) scene = plugin("resources", "The resources option").layer(config, state, result, scene);
  if (config.gantt !== undefined) scene = plugin("gantt", "The gantt option").layer(config, state, result, scene);
  // The sticky lane headers and the overview strip: the time tools' layers, drawn here so the server draws them too.
  if (config.laneHeaders === true || state.view.band > 0) scene = plugin("tools", "The laneHeaders and minimap options").layer(config, state, result, scene);
  return scene;
}

/** The overview strip's geometry for a frame, or `undefined` without one. */
export function minimapGeometryOf<T>(config: TimelineConfig<T>, state: FrameState<T>, result: RenderResult<T>): MinimapGeometry | undefined {
  if (!(state.view.band > 0) || !(state.view.mainSize > 0)) return undefined;
  return plugin("tools", "The minimap option").geometry(config, state, result);
}
