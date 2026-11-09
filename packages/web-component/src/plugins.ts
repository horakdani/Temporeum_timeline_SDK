/**
 * The element's plugins: the parts of it that come on an entry point of
 * their own.
 *
 * An earlier element imported every part of the core it can draw — the
 * Gantt chart, the resource view, export — whether a configuration asked
 * for it or not, and a page that showed a plain timeline downloaded all of
 * them. The core's promise ("you pay for what you import") held for the
 * core and not for the element. Now each of those parts is a plugin on its
 * own entry point (`@temporeum/timeline-element/gantt`, `/resources`,
 * `/export`), registered once:
 *
 *     import { registerPlugin } from "@temporeum/timeline-element";
 *     import { ganttPlugin } from "@temporeum/timeline-element/gantt";
 *     registerPlugin(ganttPlugin);
 *
 * The parts a plain timeline does not need either are plugins
 * too: the time tools (`/tools`: hidden dates, time bars, a rolling window,
 * zoom presets, the overview strip, range selection, lane headers, the
 * tooltip), the group tree (`/groups`), the item kinds, templates and
 * adding and removing (`/items`), and the other languages, directions and
 * calendars (`/intl`). The base draws, pans, zooms, edits, clusters, loads
 * windows and takes live changes, in English, left to right.
 *
 * The registry is the page's, not an instance's: a custom element
 * configured from its attributes, a server renderer and a framework
 * adapter have no place to pass a plugin, and they all draw through the
 * same frame functions. The `<script>`-tag build registers every plugin on
 * load.
 *
 * A configuration that asks for a part whose plugin is not registered is an
 * error, thrown where the timeline is created or drawn, naming the import
 * that is missing — a Gantt option silently drawing a plain timeline would
 * be a bug that looks like a feature.
 */

import type { Item, KeySample, Lane, Layout, RenderHooks, RenderResult, SceneElement } from "@temporeum/timeline-core";
import type { PngOptions } from "@temporeum/timeline-core/export";
import type { Group, GroupPatch, GroupView, GroupViewOptions } from "@temporeum/timeline-core/groups";
import type {
  addCommand,
  addTargetAt,
  addTargetFromFocus,
  applyItemPatches,
  itemForTarget,
  itemFromDrop,
  removeCommand,
  removeTargets,
  resolveItemKey,
  SplitItems,
} from "@temporeum/timeline-core/items";
import type { calendarTickLabel, calendarTicks, describeHooks, mirrorScene, mirrorTextNodes } from "@temporeum/timeline-core/intl";
import type { defaultTimeBarStep, HiddenDateRange, HiddenDates, MinimapGeometry, moveTimeBar, presetDomain, rollingDomain, ZoomPreset } from "@temporeum/timeline-core/tools";

import type { FrameState, TimelineConfig } from "./config.js";
import type { TimelinePrintOptions } from "./export.js";
import type { GroupLayer, GroupLayerHost, groupHeaderMarkup, groupLayerAttrs, headerPlacements } from "./groups/layer.js";
import type { ToolsHost, ToolsLayer } from "./tools/layer.js";

/** The Gantt chart's part of a frame. See `@temporeum/timeline-element/gantt`. */
export interface GanttFeature {
  /** The Gantt hooks over the others: progress, baselines, milestones, the dependencies in the names. */
  hooks<T>(config: TimelineConfig<T>, hooks: RenderHooks<T>, items: readonly Item<T>[], lanes: readonly Lane[] | undefined): RenderHooks<T>;
  /** The scene with the dependency arrows' layer. */
  layer<T>(config: TimelineConfig<T>, state: FrameState<T>, result: RenderResult<T>, scene: SceneElement): SceneElement;
  /**
   * The `[` and `]` keys of one instance, which remember where the last
   * press landed. A key that is not one of them is `undefined`; one of them
   * is `true` when focus moved along a dependency.
   */
  keys(): (config: TimelineConfig<unknown>, sample: KeySample, focusedId: string | null, focus: (id: string) => boolean) => boolean | undefined;
}

/** The resource view's part of a frame. See `@temporeum/timeline-element/resources`. */
export interface ResourcesFeature {
  /** The lanes with the resources': theirs when there are no others, and a load lane under each. */
  lanes<T>(config: TimelineConfig<T>, lanes: readonly Lane[] | undefined): readonly Lane[] | undefined;
  /** The resource hooks over the others: overbooked assignments marked and named. */
  hooks<T>(config: TimelineConfig<T>, hooks: RenderHooks<T>, items: readonly Item<T>[], lanes: readonly Lane[] | undefined): RenderHooks<T>;
  /** The scene with the load's layer. */
  layer<T>(config: TimelineConfig<T>, state: FrameState<T>, result: RenderResult<T>, scene: SceneElement): SceneElement;
  /** The resource a load lane belongs to; `undefined` for any other lane. */
  loadLaneOf(laneId: string): string | undefined;
}

/** Export and print. See `@temporeum/timeline-element/export`. */
export interface ExportFeature {
  /** A scene as a PNG. */
  png(doc: Document, scene: SceneElement, options?: PngOptions): Promise<Blob>;
  /** The whole range as a PDF, one page at least. */
  pdf<T>(config: TimelineConfig<T>, state: FrameState<T>, layout: Layout<T>, options: TimelinePrintOptions): Uint8Array;
  /** The whole range through the browser's print dialog. */
  print<T>(doc: Document, config: TimelineConfig<T>, state: FrameState<T>, layout: Layout<T>, options: TimelinePrintOptions): Promise<void>;
}

/** The time tools. See `@temporeum/timeline-element/tools`. */
export interface ToolsFeature {
  /** The hidden dates of some ranges, repeated in a time zone. */
  hidden(ranges: readonly HiddenDateRange[], timeZone: string): HiddenDates;
  /** The overview strip's thickness when it is on without one of its own. */
  readonly minimapSize: number;
  /** The overview strip's geometry for a frame that has one. */
  geometry<T>(config: TimelineConfig<T>, state: FrameState<T>, result: RenderResult<T>): MinimapGeometry;
  /** The scene with the sticky lane headers and the overview strip, when the configuration asks for them. */
  layer<T>(config: TimelineConfig<T>, state: FrameState<T>, result: RenderResult<T>, scene: SceneElement): SceneElement;
  /** The client's layer of controls: the time bars, the strip's window, the range, the presets, the tooltip. */
  mount<T>(root: Element | DocumentFragment, doc: Document, host: ToolsHost<T>): ToolsLayer;
  readonly moveTimeBar: typeof moveTimeBar;
  readonly defaultTimeBarStep: typeof defaultTimeBarStep;
  readonly DEFAULT_ZOOM_PRESETS: readonly ZoomPreset[];
  readonly presetDomain: typeof presetDomain;
  readonly rollingDomain: typeof rollingDomain;
}

/** The group tree. See `@temporeum/timeline-element/groups`. */
export interface GroupsFeature {
  /** The groups' lanes and the items they leave shown. */
  groupView<T>(groups: readonly Group[], items: readonly Item<T>[], options?: GroupViewOptions): GroupView<T>;
  /** The group whose header row a lane is; `undefined` for any other lane. */
  headerGroupId(laneId: string): string | undefined;
  applyGroupPatches(groups: readonly Group[], patches: readonly GroupPatch[]): Group[];
  /** The client's tree of headers over the header rows. */
  mount(root: Element | DocumentFragment, doc: Document, host: GroupLayerHost): GroupLayer;
  readonly groupLayerAttrs: typeof groupLayerAttrs;
  readonly headerPlacements: typeof headerPlacements;
  readonly groupHeaderMarkup: typeof groupHeaderMarkup;
}

/** Item kinds, templates, adding and removing. See `@temporeum/timeline-element/items`. */
export interface ItemsFeature {
  /** The hooks over the host's: a template, `box` and `point` items, the remove handle. One object per combination. */
  hooks<T>(config: TimelineConfig<T>, base: RenderHooks<T>): RenderHooks<T>;
  /** The items the layout packs, and the `background` items as decorations. */
  split<T>(items: readonly Item<T>[], timeZone: string | undefined): SplitItems<T>;
  readonly applyItemPatches: typeof applyItemPatches;
  readonly addCommand: typeof addCommand;
  readonly removeCommand: typeof removeCommand;
  readonly removeTargets: typeof removeTargets;
  readonly itemForTarget: typeof itemForTarget;
  readonly itemFromDrop: typeof itemFromDrop;
  readonly addTargetAt: typeof addTargetAt;
  readonly addTargetFromFocus: typeof addTargetFromFocus;
  readonly resolveItemKey: typeof resolveItemKey;
  /** The drag-and-drop type an item from outside comes as. */
  readonly DROP_MIME: string;
}

/** Other languages, directions and calendars. See `@temporeum/timeline-element/intl`. */
export interface IntlFeature {
  readonly mirrorScene: typeof mirrorScene;
  readonly mirrorTextNodes: typeof mirrorTextNodes;
  readonly describeHooks: typeof describeHooks;
  readonly calendarTicks: typeof calendarTicks;
  readonly calendarTickLabel: typeof calendarTickLabel;
}

interface Features {
  readonly gantt: GanttFeature;
  readonly resources: ResourcesFeature;
  readonly export: ExportFeature;
  readonly tools: ToolsFeature;
  readonly groups: GroupsFeature;
  readonly items: ItemsFeature;
  readonly intl: IntlFeature;
}

/** The name a plugin is registered under — and its entry point's. */
export type PluginName = keyof Features;

/**
 * A plugin, as its entry point exports it: `ganttPlugin`, `resourcesPlugin`,
 * `exportPlugin`, `toolsPlugin`, `groupsPlugin`, `itemsPlugin`, `intlPlugin`. What is inside is the element's own business and may
 * change in any release; register it, do not call into it.
 */
export type TimelinePlugin = { readonly [K in PluginName]: { readonly name: K; readonly feature: Features[K] } }[PluginName];

/** This package's version; `scripts/sdk_check_pack.mjs` holds it to the manifest. */
const RELEASE = "1.0.1";

/**
 * The registry, on the global object under a registered symbol: a page with
 * two copies of this module of one release — the ESM and the CJS build, or a
 * bundle that did not dedupe — has one registry, so a plugin registered
 * through one is there for a timeline made by the other. Each release has its
 * own: what a plugin hands the element is internal and changes between
 * releases, so a copy never draws with another release's plugin — without its
 * own, it says which import is missing.
 */
const REGISTRY = Symbol.for(`@temporeum/timeline/plugins@${RELEASE}`);

type Registry = { -readonly [K in PluginName]?: Features[K] };

/** Taken when first asked for: importing the module writes nothing. */
function registry(): Registry {
  const global = globalThis as { [REGISTRY]?: Registry };
  return (global[REGISTRY] ??= {});
}

/**
 * Register plugins for every timeline on the page — the instances, the
 * custom elements and the server renderer alike. Once is enough; again is
 * harmless.
 */
export function registerPlugin(...plugins: readonly TimelinePlugin[]): void {
  for (const plugin of plugins) {
    (registry() as Record<string, unknown>)[plugin.name] = plugin.feature;
  }
}

/** Whether a plugin is registered. */
export function hasPlugin(name: PluginName): boolean {
  return registry()[name] !== undefined;
}

/** A registered plugin's part, or `undefined`. */
export function pluginIf<K extends PluginName>(name: K): Features[K] | undefined {
  return registry()[name];
}

/** A registered plugin's part; `what` — an option, a method — asked for it and gets named in the error without one. */
export function plugin<K extends PluginName>(name: K, what: string): Features[K] {
  const feature = registry()[name];
  if (feature === undefined) {
    throw new TypeError(
      `${what} needs the ${name} plugin: import { ${name}Plugin } from "@temporeum/timeline-element/${name}" and call registerPlugin(${name}Plugin) before the timeline draws`,
    );
  }
  return feature;
}

const ITEM_KINDS: ReadonlySet<unknown> = new Set(["box", "point", "background"]);

/**
 * Throw for an item of a kind the `/items` plugin draws — `box`, `point`,
 * `background` — when the plugin is not registered: without it such an item
 * would be drawn as a plain range, which is a bug that looks like a feature.
 */
export function requireKinds<T>(items: readonly Item<T>[]): void {
  if (registry().items !== undefined) return;
  for (const item of items) if (ITEM_KINDS.has(item.kind)) plugin("items", `An item of kind "${String(item.kind)}"`);
}

/** The time tools a configuration asks for: the first option that needs them, or `undefined`. */
function toolOf<T>(config: Pick<TimelineConfig<T>, ToolOption>): ToolOption | undefined {
  if (config.hiddenDates !== undefined && config.hiddenDates.length > 0) return "hiddenDates";
  if (config.timeBars !== undefined && config.timeBars.length > 0) return "timeBars";
  for (const key of ["rolling", "zoomPresets", "minimap", "rangeSelect", "laneHeaders", "tooltip"] as const) {
    if (config[key] !== undefined && config[key] !== false) return key;
  }
  return undefined;
}

type ToolOption = "hiddenDates" | "timeBars" | "rolling" | "zoomPresets" | "minimap" | "rangeSelect" | "laneHeaders" | "tooltip";

/**
 * Throw now, where a configuration was given, for a part of it whose plugin
 * is not registered — not later, inside a frame the browser draws. The
 * items' kinds are {@link requireKinds}'.
 */
export function requirePlugins<T>(
  config: Pick<TimelineConfig<T>, "gantt" | "resources" | "groups" | "template" | "slots" | "editing" | "strings" | "calendar" | "direction" | ToolOption>,
): void {
  if (config.gantt !== undefined) plugin("gantt", "The gantt option");
  if (config.resources !== undefined) plugin("resources", "The resources option");
  const tool = toolOf(config);
  if (tool !== undefined) plugin("tools", `The ${tool} option`);
  if (config.groups !== undefined) plugin("groups", "The groups option");
  if (config.template !== undefined) plugin("items", "The template option");
  if (config.slots !== undefined && config.slots !== false) plugin("items", "The slots option");
  const editing = config.editing;
  for (const key of ["add", "remove", "drop"] as const) if (editing?.[key] === true) plugin("items", `The editing.${key} option`);
  if (config.strings !== undefined) plugin("intl", "The strings option");
  if (config.calendar !== undefined) plugin("intl", "The calendar option");
  if (config.direction === "rtl" || config.direction === "auto") plugin("intl", `The direction "${config.direction}" option`);
}
