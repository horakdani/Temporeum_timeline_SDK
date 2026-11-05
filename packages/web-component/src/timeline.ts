/**
 * `createTimeline` — the one live timeline the wrappers share.
 *
 * Without it, every page would wire the same dozen pieces by hand: a
 * machine, a mount, a binding, a hit tester rebuilt per frame, a navigator,
 * a size observer, the effects loop. This is that wiring, once. The custom
 * element is a shell around it, and so is the React component — neither of
 * them draws, binds or decides anything of its own, which is what keeps the
 * three from drifting apart.
 *
 * It is also an external store. `subscribe` and `getSnapshot` are the shape
 * `useSyncExternalStore` expects: the snapshot is a plain frozen object that
 * gets a new identity only when something in it changed, and it changes at
 * most once per drawn frame — a pan of a hundred pointer events is as many
 * notifications as it is frames, not as it is events — and besides only when
 * the selection or the focus changes, at the change. A framework that
 * subscribes therefore re-renders what depends on the view, not the
 * timeline, and not on every event.
 *
 * The library never persists. An edit is shown while it is under way and
 * kept when it ends, and the host is told (`itemMoved`, `command`); what it
 * does with that — save, refuse, undo — is the host's. `setItems` replaces
 * whatever the instance holds.
 */

import {
  applyPatches,
  clusterZoom,
  createHitTester,
  itemRect,
  createInputMachine,
  createItemLoader,
  createNavigator,
  createTimeScale,
  densityMetrics,
  Emitter,
  estimateTextWidth,
  planSceneSpace,
  renderTimeline,
  renderToSvgString,
  toTimeMs,
} from "@temporeum/timeline-core";
import type {
  Cluster,
  Clustering,
  Command,
  Density,
  DensityMetrics,
  Domain,
  HitTester,
  InputEffect,
  InputMachine,
  Item,
  ItemLoader,
  ItemPatch,
  Lane,
  Layout,
  MainCrossRect,
  MeasureText,
  Orientation,
  RenderResult,
  SceneElement,
  SceneSpace,
  TimeInput,
  TimelineEventMap,
  TimeMs,
  Unsubscribe,
  Viewport,
  ViewportChangeReason,
} from "@temporeum/timeline-core";
import { attachInput, createFrameLoop, mountScene, observeSize } from "@temporeum/timeline-core/dom";
import type { FrameLoop, InputBinding, SceneMount, SizeObservation } from "@temporeum/timeline-core/dom";
import type { Group, GroupCommand } from "@temporeum/timeline-core/groups";
import { applyItemChanges, relayout } from "@temporeum/timeline-core/live";
import type { ItemChanges, ItemUpdate } from "@temporeum/timeline-core/live";
import type { TimeBar, TimeBarMovedPayload, TimeRange, ZoomPreset } from "@temporeum/timeline-core/tools";
import type { AddTarget } from "@temporeum/timeline-core/items";
import type { Strings } from "@temporeum/timeline-core/words";
import type { PngOptions } from "@temporeum/timeline-core/export";

import { checkMetrics, contentOf, exportTheme, frameOptions, frameScene, groupViewOf, hiddenDatesOf, initialDomain, itemsOf, metricsOf, readableItems, readableOptionsOf, minimapGeometryOf, resolveView, sameValue, sizesOf, slotsOn, usesSceneSpace, wordsOf } from "./config.js";
import type { FrameState, InputSkippedPayload, ResolvedView, SkipReport, TimelineConfig, TimelineRollingOptions, TimelineUpdate } from "./config.js";
import type { TimelinePrintOptions } from "./export.js";
import { plugin, pluginIf, requireKinds, requirePlugins } from "./plugins.js";
import type { GanttFeature } from "./plugins.js";
import type { ToolsHost, ToolsLayer } from "./tools/layer.js";
import type { GroupLayer } from "./groups/layer.js";

/** The view state a framework renders from. Frozen; a new object only on change. */
export interface TimelineSnapshot {
  readonly domain: Domain;
  /** `undefined` until the container has a size and the first frame is drawn. */
  readonly viewport: Viewport | undefined;
  readonly orientation: Orientation;
  readonly density: Density;
  readonly selectedIds: readonly string[];
  readonly focusedId: string | null;
  /** Items represented on screen, each cluster counted by its members. */
  readonly visibleCount: number;
  /** A fetched source has a window in flight. */
  readonly busy: boolean;
  /** A move or resize is under way. */
  readonly editing: boolean;
  /** How far the lanes are scrolled across, in CSS pixels — what a task grid beside the timeline follows. */
  readonly crossOffset: number;
}

/** `densityChanged`: an `auto` density resolved to another after a resize or a change of the rows. */
export interface DensityChangedPayload {
  readonly density: Density;
  readonly previous: Density;
}

/** `orientationChanged`: an `auto` orientation resolved to the other after a resize. */
export interface OrientationChangedPayload {
  readonly orientation: Orientation;
  readonly previous: Orientation;
}

/** `clusterOpened`: a cluster was opened — the view zooms into its time. */
export interface ClusterOpenedPayload<T = unknown> {
  readonly cluster: Cluster<T>;
}

/** `itemsChanged`: the items the instance holds now, after any change to them. */
export interface ItemsChangedPayload<T = unknown> {
  readonly items: readonly Item<T>[];
}

/** `itemsAdded`: the items added and the add as a reversible command (also emitted as `command`). */
export interface ItemsAddedPayload<T = unknown> {
  /** The items added — one for a tap, a key or a drop. */
  readonly items: readonly Item<T>[];
  readonly command: Command<T>;
}

/** `itemsRemoved`: the items removed and the removal as a reversible command (also emitted as `command`). */
export interface ItemsRemovedPayload<T = unknown> {
  readonly items: readonly Item<T>[];
  readonly command: Command<T>;
}

/** `groupToggled`: a group was collapsed or expanded. View state: nothing to save. */
export interface GroupToggledPayload {
  readonly group: Group;
  readonly collapsed: boolean;
}

/** `groupMoved`: a group was moved among its siblings; `command.inverse` moves it back. */
export interface GroupMovedPayload {
  readonly command: GroupCommand;
}

/** An item's slot (`config.slots`): the element to render its content into, and the item. */
export interface ItemSlot<T = unknown> {
  /**
   * The item's own host, in the box drawn over it: the same element for as
   * long as the item is drawn, through pans, zooms and live changes.
   */
  readonly element: HTMLElement;
  readonly item: Item<T>;
}

/** `slotsChanged`: the slots drawn now (`config.slots`), in the frame that drew them. */
export interface SlotsChangedPayload<T = unknown> {
  /** Every slot drawn now, by item id. */
  readonly slots: ReadonlyMap<string, ItemSlot<T>>;
}

/** `jumpRequest`: the reader asked to jump to a date (`g`) — the host opens its date picker. */
export interface JumpRequestPayload {
  /** The middle of the view, where a date picker would start. */
  readonly time: TimeMs;
}

/**
 * Everything the instance emits: the core's event map, plus what only an
 * instance can know — that `auto` resolved differently after a resize, that
 * a cluster was opened, that the user asked for a date.
 */
export interface TimelineInstanceEventMap<T = unknown> extends TimelineEventMap<T> {
  /** The density changed (`density: "auto"`, a resize). */
  readonly densityChanged: DensityChangedPayload;
  /** The orientation changed (`orientation: "auto"` past the breakpoint). */
  readonly orientationChanged: OrientationChangedPayload;
  /** A cluster was opened. */
  readonly clusterOpened: ClusterOpenedPayload<T>;
  /** The reader asked to jump to a date (`g`): the host opens its date picker. */
  readonly jumpRequest: JumpRequestPayload;
  /** Items were added — by a double tap, a key, a drop or `dropItem`. `command` is also emitted. */
  readonly itemsAdded: ItemsAddedPayload<T>;
  /** Items were removed — by a remove handle or a key. `command` is also emitted. */
  readonly itemsRemoved: ItemsRemovedPayload<T>;
  /**
   * The items are another array: an edit, an add, a removal, a command
   * applied, new items set or a window fetched. What a list that follows the
   * items — a backlog — listens to.
   */
  readonly itemsChanged: ItemsChangedPayload<T>;
  /** A group was collapsed or expanded. View state: nothing to save. */
  readonly groupToggled: GroupToggledPayload;
  /** The groups were reordered. `command.inverse` undoes it. */
  readonly groupMoved: GroupMovedPayload;
  /** A time bar was moved — let go after a drag, or a key step. The instance keeps it there. */
  readonly timeBarMoved: TimeBarMovedPayload;
  /** A range of time was selected — by a drag along the axis band, or `r`, the arrows and `Enter`. */
  readonly rangeSelected: TimeRange;
  /**
   * The slots drawn are others (`config.slots`): an item scrolled in or
   * out, or changed. Emitted in the frame that drew them, before the
   * browser paints it.
   */
  readonly slotsChanged: SlotsChangedPayload<T>;
  /**
   * An item or an option could not be read, and was left out so the rest is
   * drawn: an item with no string id, a start or end that is not a time, a
   * fractional `sublaneSpan`; a `locale` or `timeZone` the platform does not
   * know, which falls back to the default. What was there at creation is
   * said on the microtask after it, so a listener added right away hears it.
   */
  readonly inputSkipped: InputSkippedPayload;
}

/** The name of an event of {@link TimelineInstanceEventMap}. */
export type TimelineInstanceEventName = keyof TimelineInstanceEventMap & string;

/** Every event name, once: a record over the map, so a new event that is not listed does not compile. */
const EVENT_NAMES: Record<TimelineInstanceEventName, true> = {
  itemClick: true,
  itemDblClick: true,
  itemHover: true,
  selectionChanged: true,
  viewportChanged: true,
  layoutChanged: true,
  itemMoved: true,
  itemResized: true,
  command: true,
  densityChanged: true,
  orientationChanged: true,
  clusterOpened: true,
  jumpRequest: true,
  itemsAdded: true,
  itemsRemoved: true,
  itemsChanged: true,
  groupToggled: true,
  groupMoved: true,
  timeBarMoved: true,
  rangeSelected: true,
  slotsChanged: true,
  inputSkipped: true,
};

/** Every event the instance emits — what the element and the framework adapters forward. */
export const TIMELINE_EVENTS: readonly TimelineInstanceEventName[] = Object.freeze(Object.keys(EVENT_NAMES) as TimelineInstanceEventName[]);

/** How an instance is attached. */
export interface CreateTimelineOptions {
  /**
   * Where the drawing goes, when it is not the element itself — the custom
   * element passes its shadow root. Events are still bound to the element.
   */
  readonly root?: Element | DocumentFragment;
  /** Take over a server-rendered drawing in `root` instead of drawing beside it. */
  readonly hydrate?: boolean;
  /**
   * Measure label text with the page's font. On by default; off draws
   * exactly what the server drew, which is what a hydration test compares.
   * (A configuration's `measureText` is the measuring function itself.)
   */
  readonly measureLabels?: boolean;
}

/** A live timeline. */
export interface Timeline<T = unknown> {
  /** Listen to one event. Returns the unsubscribe function. */
  on<K extends TimelineInstanceEventName>(type: K, listener: (payload: TimelineInstanceEventMap<T>[K]) => void): Unsubscribe;
  /** Store protocol: called after every frame whose snapshot changed. */
  subscribe(listener: () => void): Unsubscribe;
  getSnapshot(): TimelineSnapshot;
  /**
   * Change any part of the configuration. Omitted keys keep their value; a
   * key present with `undefined` goes back to its default. A value equal to
   * the one the instance already has is no change — for `items` that means
   * the same array: a host that re-sends its props after an edit keeps the
   * edit. To replace the items with the very array given before, call
   * {@link setItems}. The option objects (`editing`, `interactions`,
   * `limits`, `hiddenDates`, `timeBars`, `rolling`), `domain` and
   * `selectedIds` are compared by what they say, so `editing: { enabled:
   * true }` written anew on every render neither restarts a drag nor moves
   * the view back; a new function in them (`canMove`) is called from then
   * on. A new fetch function for `items` is the one the next fetch calls,
   * and what was loaded stays — `setItems` reloads. To move the view the
   * reader moved, `zoomTo`; to change the selection, `select`.
   */
  update(config: TimelineUpdate<T>): void;
  /**
   * Replace the items — always, the same array included: edits the instance
   * holds and the host did not write back are dropped, and the array (or the
   * source) given is what the timeline shows. `update({ items })` with an
   * array the instance already has is no change; this is the call that says
   * "these, again".
   */
  setItems(items: TimelineConfig<T>["items"] | undefined): void;
  /** Apply a command's patches — `command.inverse` is an undo. Group commands reorder the groups. */
  applyCommand(command: Command | GroupCommand): void;
  /** Collapse (`{ collapsed: true }`) or expand (`{ collapsed: false }`) a group; without `collapsed`, toggle it. */
  toggleGroup(id: string, options?: { readonly collapsed?: boolean }): void;
  /**
   * Add an item the way a drop adds one, at the keyboard's place: the middle
   * of the view, in the focused item's lane. The keyboard twin of dragging an
   * external element in — a host binds it to its own list's key. `false` when
   * nothing was added (dropping off, vetoed, an id already there).
   */
  dropItem(payload: Partial<Item<T>> & { readonly durationMs?: number }): boolean;
  /**
   * Add an item the way a drop adds one, where a pointer let go — the time
   * and the lane under it (a load lane counting as its resource). What a
   * list that drags its own rows calls on release, for a mouse, a pen and a
   * finger alike. `false` when nothing was added: the point is outside the
   * timeline, dropping is off, vetoed, or the id is already there.
   */
  dropItemAt(payload: Partial<Item<T>> & { readonly durationMs?: number }, at: { readonly clientX: number; readonly clientY: number }): boolean;
  /** The items as they are now, edits included. */
  readonly items: readonly Item<T>[];
  /**
   * Live data: add items without reloading the others. Only the lanes the
   * new items land in are packed again; the frame is the one `setItems`
   * with the whole array would draw. Throws for an id already there, and for
   * a fetched source, whose items are its own.
   */
  addItems(items: readonly Item<T>[]): void;
  /** Live data: change fields of items, by id. `undefined` takes a field away. Throws for an unknown id. */
  updateItems(updates: readonly ItemUpdate<T>[]): void;
  /** Live data: remove items by id. An id that is not there is not an error. */
  removeItems(ids: readonly string[]): void;
  /** Live data: one batch of adds, updates and removals, drawn once. */
  changeItems(changes: ItemChanges<T>): void;
  /** The time bars, where the reader left them. */
  readonly timeBars: readonly TimeBar[];
  /** Zoom to a named preset (`zoomPresets`) around the middle of the view, or a time. `false` for an unknown id. */
  zoomToPreset(id: string, around?: TimeInput): boolean;
  /** Follow the clock again after the reader moved the view (`rolling`). */
  follow(): void;
  zoomTo(domain: readonly [TimeInput, TimeInput]): void;
  /** Zoom by a factor (2 = twice as close) around a time, the middle by default. */
  zoomBy(factor: number, around?: TimeInput): void;
  /** Bring a time to the middle of the view, the way the keyboard's jump does. */
  scrollTo(time: TimeInput): void;
  select(ids: readonly string[]): void;
  readonly layout: Layout<T> | undefined;
  /** The sizes the last frame was drawn with — its density's, with `config.metrics` over them. A panel beside the timeline lines up with these. */
  readonly metrics: DensityMetrics | undefined;
  /** The slots drawn now, by item id; empty without `config.slots`. */
  readonly slots: ReadonlyMap<string, ItemSlot<T>>;
  /**
   * Put the keyboard's focus on an item and bring it into view — its time
   * along the axis, its lane across. A task grid's `Enter` calls it. `false`
   * for an item the layout does not hold.
   */
  focusItem(id: string): boolean;
  /** Scroll the lanes across by a number of CSS pixels, as a wheel over the lanes does. */
  scrollLanes(delta: number): void;
  /** Scroll the lanes across just enough to show one lane whole. */
  revealLane(laneId: string): void;
  /** The last frame, for hit testing or export. */
  readonly result: RenderResult<T> | undefined;
  /**
   * The current drawing as a standalone SVG document. An `auto` theme is
   * pinned to what the screen shows. Throws before the first frame: there is
   * nothing drawn to export yet.
   */
  exportSvg(): string;
  /**
   * The current drawing as a PNG, `scale` device pixels per CSS pixel (2 by
   * default). Rejects before the first frame, and without the export plugin.
   */
  exportPng(options?: PngOptions): Promise<Blob>;
  /**
   * The whole range as a PDF, with no server: vector, its text selectable,
   * the lanes cut between rows onto as many pages as they need — each item
   * on exactly one. The drawing is the one at the call. Rejects before the
   * first frame, and without the export plugin, naming its import.
   */
  exportPdf(options?: TimelinePrintOptions): Promise<Uint8Array>;
  /**
   * Print the whole range through the browser's dialog, a page a sheet, cut
   * as {@link exportPdf} cuts it. Resolves when the dialog is closed and the
   * print view has left the document. Rejects before the first frame, and
   * without the export plugin.
   */
  print(options?: TimelinePrintOptions): Promise<void>;
  /** Draw now instead of on the next animation frame. */
  flush(): void;
  readonly destroyed: boolean;
  /**
   * The `nonce` it was created with (`config.nonce`), for the `<style>`s of
   * what is mounted beside it — `mountStory`, `mountBacklog` and
   * `mountTaskGrid` take it from here.
   */
  readonly nonce: string | undefined;
  /**
   * Let go of the container, the listeners and the timers. After it a method
   * that would change something does nothing and emits nothing — one that
   * answers with a `boolean` answers `false` — and the getters, the snapshot
   * and the exports read the last frame.
   */
  destroy(): void;
}

/** How long a run of key steps outlasts its last step — as long as the machine's wheel run. The browser's `scrollend` waits about as long. */
const COAST_MS = 150;

/** Label widths kept: more than the labels of a 10 000-item timeline. */
const MEASURE_CACHE_SIZE = 16_384;

const keyboardLayouts = new WeakMap<Layout<unknown>, Layout<unknown>>();

/**
 * The layout the keyboard walks: without the rows an item cannot be moved
 * into — a group's header, a resource's load lane. One object per layout, so
 * the navigator built on it is memoised with it.
 */
function keyboardLayout<T>(layout: Layout<T>): Layout<T> {
  let walked = keyboardLayouts.get(layout as Layout<unknown>);
  if (walked === undefined) {
    const loadLaneOf = pluginIf("resources")?.loadLaneOf;
    const headerGroupId = pluginIf("groups")?.headerGroupId;
    const lanes = layout.lanes.filter((lane) => headerGroupId?.(lane.lane.id) === undefined && loadLaneOf?.(lane.lane.id) === undefined);
    walked = (lanes.length === layout.lanes.length ? layout : { ...layout, lanes }) as Layout<unknown>;
    keyboardLayouts.set(layout as Layout<unknown>, walked);
  }
  return walked as Layout<T>;
}

const keyboardClusterings = new WeakMap<Clustering<unknown>, Clustering<unknown>>();

/**
 * The clustering, as the clustering of the layout the keyboard walks. The
 * rows left out hold no item, so they hold no cluster either: the clusters
 * are the same, only the layout they belong to is the walked one. One
 * object per clustering, so the navigator is memoised with it.
 */
function keyboardClustering<T>(clustering: Clustering<T> | undefined, walked: Layout<T>): Clustering<T> | undefined {
  if (clustering === undefined || clustering.layout === walked) return clustering;
  const known = keyboardClusterings.get(clustering as Clustering<unknown>);
  if (known !== undefined) return known as Clustering<T>;
  const view: Clustering<T> = {
    ...clustering,
    layout: walked,
    clusterOf: (itemId) => clustering.clusterOf(itemId),
    byId: (clusterId) => clustering.byId(clusterId),
  };
  keyboardClusterings.set(clustering as Clustering<unknown>, view as Clustering<unknown>);
  return view;
}

/** A canvas-backed measurer with the stylesheet's font, cached per string. */
function canvasMeasure(doc: Document, family: () => string): MeasureText | undefined {
  const context = doc.createElement("canvas").getContext("2d");
  if (context === null) {
    return undefined;
  }
  // One table per font. A frame measures thousands of labels in one or two
  // fonts, so the font is looked up once per change of font, not once per
  // label: building the density's metrics and a key holding the whole font
  // stack on every call would be most of what measuring costs.
  const fonts = new Map<string, Map<string, number>>();
  let last: { family: string; fontSize: number; font: string; widths: Map<string, number> } | undefined;
  return (text, fontSize) => {
    const currentFamily = family();
    if (last?.fontSize !== fontSize || last.family !== currentFamily) {
      const font = `${String(fontSize)}px ${currentFamily}`;
      let widths = fonts.get(font);
      if (widths === undefined) {
        widths = new Map();
        fonts.set(font, widths);
      }
      last = { family: currentFamily, fontSize, font, widths };
    }
    const { font, widths } = last;
    let width = widths.get(text);
    if (width === undefined) {
      context.font = font;
      width = context.measureText(text).width;
      // Evict the oldest, not everything: a pan over ten thousand distinct
      // labels would otherwise measure every one of them again on each
      // frame that redraws, which is the frame a gesture can least afford.
      if (widths.size >= MEASURE_CACHE_SIZE) widths.delete(widths.keys().next().value as string);
      widths.set(text, width);
    }
    return width;
  };
}

/**
 * The letter and word spacing labels are drawn with, in px at `fontSize`:
 * the reader's own (WCAG 1.4.12's override, a reading extension, a
 * bookmarklet) or a host's. Nothing when there is none.
 */
interface TextSpacing {
  readonly letter: number;
  readonly word: number;
  readonly fontSize: number;
}

/** The spacing `from` computes, or nothing when it has none. */
function textSpacingOf(view: Window | null, from: Element): TextSpacing | undefined {
  const style = view?.getComputedStyle(from);
  if (style === undefined) return undefined;
  // "normal" reads as NaN: no spacing.
  const letter = Number.parseFloat(style.letterSpacing) || 0;
  const word = Number.parseFloat(style.wordSpacing) || 0;
  return letter === 0 && word === 0 ? undefined : { letter, word, fontSize: Number.parseFloat(style.fontSize) || 1 };
}

function sameSpacing(a: TextSpacing | undefined, b: TextSpacing | undefined): boolean {
  return a === undefined || b === undefined ? a === b : a.letter === b.letter && a.word === b.word && a.fontSize === b.fontSize;
}

/**
 * `measure` with the spacing added: the letter spacing after every
 * character, as the browser adds it, and the word spacing at every space.
 * The spacing was read at one font size; at another, an `em` spacing scales
 * and an inherited `px` one does not, and which it was is not known — so it
 * is taken at whichever is wider. A label is then given its room or a
 * little more, never less than it is drawn with.
 */
function spacedMeasure(measure: MeasureText, spacing: TextSpacing): MeasureText {
  return (text, fontSize) => {
    const ratio = fontSize / spacing.fontSize;
    const at = (value: number): number => value * (value > 0 ? Math.max(1, ratio) : Math.min(1, ratio));
    let characters = 0;
    let spaces = 0;
    for (const character of text) {
      characters += 1;
      if (character === " " || character === "\u00a0") spaces += 1;
    }
    return measure(text, fontSize) + at(spacing.letter) * characters + at(spacing.word) * spaces;
  };
}

/**
 * Calls `onChange` when the text spacing in `container` changes after load.
 * No event says a stylesheet came or went, so the theme gives the root a
 * one-millisecond transition on both spacings, and its end is the event.
 * The end, not the start: the labels inherit the root's spacing in a shadow
 * root, and mid-transition they would read a value on its way. A reader who
 * turned transitions off gets the spacing measured at the next resize.
 */
function watchTextSpacing(container: Element | DocumentFragment, onChange: () => void): () => void {
  const listener = (event: Event): void => {
    const property = (event as TransitionEvent).propertyName;
    if (property === "letter-spacing" || property === "word-spacing") onChange();
  };
  container.addEventListener("transitionend", listener);
  return () => {
    container.removeEventListener("transitionend", listener);
  };
}

function restoreOf<T>(item: Item<T>): ItemPatch {
  return {
    id: item.id,
    start: toTimeMs(item.start),
    end: item.end === undefined ? null : toTimeMs(item.end),
    laneId: item.laneId ?? null,
  };
}

/** The scroll across that shows a lane whole: as little a scroll as it takes, none if it is shown. */
function revealOffset(lane: { readonly cross: number; readonly crossSize: number }, offset: number, viewCrossSize: number, crossInset: number): number {
  const room = viewCrossSize - crossInset;
  if (lane.cross < offset) return lane.cross;
  if (lane.cross + lane.crossSize > offset + room) return Math.max(0, lane.cross + lane.crossSize - room);
  return offset;
}

/** Whether a command places groups rather than items (`isGroupCommand` in `/groups`). */
/** The keys `update` compares by what they say, not by identity. */
const SETTLED = ["domain", "selectedIds", "editing", "interactions", "limits", "touchAction", "hiddenDates", "timeZone", "timeBars", "rolling"] as const;

function sameDomain(a: readonly [TimeInput, TimeInput] | undefined, b: readonly [TimeInput, TimeInput]): boolean {
  return a !== undefined && toTimeMs(a[0]) === toTimeMs(b[0]) && toTimeMs(a[1]) === toTimeMs(b[1]);
}

/** The editing rules as the input machine is built from them: a callback counts as there, not as which function it is — it is read when it is asked. */
function rulesOf(editing: object | undefined): unknown {
  if (editing === undefined) return undefined;
  return Object.fromEntries(Object.entries(editing).map(([key, value]) => [key, typeof value === "function" ? true : value]));
}

function isGroupCommand(command: Command | GroupCommand): command is GroupCommand {
  return command.type === "moveGroup";
}

/** The dictionary's word for each default zoom preset. */
const PRESET_WORDS: Readonly<Record<string, keyof Strings>> = { day: "zoomDay", week: "zoomWeek", month: "zoomMonth", year: "zoomYear" };

/** How many light-DOM timelines have taken a scope of their own: each takes the next. */
let autoScopes = 0;

/**
 * Create a live timeline on an element.
 *
 * The element is what receives pointer and key events and what is
 * measured; the drawing goes into `options.root` when given (a shadow root),
 * into the element otherwise. Nothing is drawn until the element has a
 * width — the core's renderer draws an empty frame for zero pixels, and the
 * size observer reports the real width on the next layout.
 */
export function createTimeline<T = unknown>(
  element: HTMLElement,
  initial: TimelineConfig<T> = {},
  options: CreateTimelineOptions = {},
): Timeline<T> {
  requirePlugins(initial);
  checkMetrics(initial);
  // What cannot be read is left out, and said once the host can listen: on the microtask after creation.
  const skippedAtStart: InputSkippedPayload[] = [];
  let say: SkipReport = (skipped) => void skippedAtStart.push(skipped);
  const report: SkipReport = (skipped) => say(skipped);
  const readableInitial = readableOptionsOf(initial, report);
  // `useSource` below says what it leaves out.
  const initialItems = itemsOf(readableInitial);
  requireKinds(initialItems);
  const doc = element.ownerDocument;
  const view_ = doc.defaultView;
  // The layers over the drawing (the tools, the groups) are positioned against the host: a host that is not positioned itself
  // would hand them to whatever ancestor is, and they would land beside the drawing. The element's own host is positioned already.
  const ownPosition = element.style.position;
  const claimedPosition = view_?.getComputedStyle(element).position === "static";
  if (claimedPosition) element.style.position = "relative";
  const inShadow = typeof ShadowRoot !== "undefined" && options.root instanceof ShadowRoot;
  let config: TimelineConfig<T> = { ...readableInitial };
  if (config.instanceId === undefined && !inShadow) {
    // In the light DOM two timelines would share one stylesheet's rules and ids: each gets a scope of
    // its own, as the framework components give theirs. A drawing taken over from the server keeps
    // the scope the server gave it, or none.
    const scope = options.hydrate === true ? (options.root ?? element).querySelector("svg[data-tl-instance]")?.getAttribute("data-tl-instance") : `tl-auto${String(++autoScopes)}`;
    if (scope !== undefined && scope !== null) config = { ...config, instanceId: scope };
  }
  const emitter = new Emitter<TimelineInstanceEventMap<T>>();
  const listeners = new Set<() => void>();

  let items: readonly Item<T>[] = initialItems;
  /** The groups as the reader reordered them; `config.groups` until then. */
  let groups: readonly Group[] | undefined = config.groups;
  /** Collapsed groups. View state, like the selection: seeded from `Group.collapsed`. */
  let collapsed: ReadonlySet<string> = new Set((groups ?? []).filter((group) => group.collapsed === true).map((group) => group.id));
  let groupLayer: GroupLayer | undefined;
  /** The element a press began on, for the remove handle: a tap only knows where, not on what. */
  let pressTarget: Element | undefined;
  let loader: ItemLoader<T> | undefined;
  let stopLoader: Unsubscribe | undefined;
  let domain = initialDomain(config);
  let width = 0;
  let measuredHeight = 0;
  let view: ResolvedView | undefined;
  let selectedIds: readonly string[] = config.selectedIds ?? [];
  let result: RenderResult<T> | undefined;
  let tester: HitTester<T> | undefined;
  let restore: ItemPatch[] = [];
  let editing = false;
  let reason: ViewportChangeReason = "init";
  let lastViewport: Viewport | undefined;
  let lastLayout = "";
  let snapshot: TimelineSnapshot = Object.freeze({
    domain,
    viewport: undefined,
    orientation: "horizontal",
    density: "comfortable",
    selectedIds,
    focusedId: null,
    visibleCount: 0,
    busy: false,
    editing: false,
    crossOffset: 0,
  });
  let destroyed = false;
  let wakeUp: ReturnType<typeof setTimeout> | undefined;
  let space: SceneSpace | undefined;
  /** A pan or pinch is under way: the space may stretch, and does not grow. */
  let gesture = false;
  /**
   * A run of key steps is under way. It has no start and no end of its own,
   * so it lasts until {@link COAST_MS} pass without one: settling after every
   * step would re-anchor — redraw everything in view — on every step, and
   * then spend the frames between them drawing overscan. A run of wheel steps
   * is the machine's own gesture (`kind: "wheel"`, since rc.3), so it comes
   * with a start and an end.
   */
  let coasting = false;
  let coastTimer: ReturnType<typeof setTimeout> | undefined;
  /**
   * The reader has touched the timeline. Until then the space draws the view
   * only: a timeline nobody pans — most of them, on a page of text — costs
   * no more nodes, memory or frames after load than an exact one. The
   * overscan fills in at rest after the first input.
   */
  let touched = false;
  /** The time bars, where the reader left them: `config.timeBars` until a move. */
  let bars: readonly TimeBar[] = config.timeBars ?? [];
  /** Following the clock (`rolling`), until the reader moves the view. */
  let following = rollingOf(config) !== undefined;
  let rollTimer: ReturnType<typeof setInterval> | undefined;
  /** Live changes since the last frame: the items they began from and led to, and the lanes they touched. */
  let live: { readonly from: readonly Item<T>[]; readonly to: readonly Item<T>[]; readonly touched: ReadonlySet<string> } | undefined;
  /** What the last frame was laid out from — for the next live change to build on. */
  let lastFrame: { readonly items: readonly Item<T>[]; readonly lanes: readonly Lane[] | undefined; readonly key: string } | undefined;
  /** A layout `relayout` made, for as long as its items are drawn. */
  let liveLayout: { readonly items: readonly Item<T>[]; readonly layout: Layout<T> } | undefined;
  let toolsLayer: ToolsLayer | undefined;

  // In a shadow root the page styles the drawing through `::part()` and the
  // tokens it sets on the element: the nodes carry their classes as parts,
  // and the stylesheet declares the tokens on `:host`.
  const nonce = config.nonce;
  const mount: SceneMount = mountScene(options.root ?? element, { hydrate: options.hydrate === true, parts: inShadow, ...(nonce === undefined ? {} : { nonce }) });
  const measured =
    options.measureLabels === false
      ? undefined
      : canvasMeasure(doc, () => (view === undefined ? densityMetrics("comfortable", "horizontal") : sizesOf(view)).fontFamily);
  // The labels are measured with the spacing they are drawn with (WCAG
  // 1.4.12): read before the first frame, and again whenever it changes. A
  // new spacing is a new measurer, and the renderer's caches, keyed by it,
  // lay the labels out again.
  let measure = measured;
  let spacing: TextSpacing | undefined;
  let spacingStale = true;
  const stopSpacingWatch = watchTextSpacing(options.root ?? element, () => {
    spacingStale = true;
    loop.request();
  });
  /**
   * The spacing a drawn label computes. Before the first label it is the
   * element's, at the element's font size, and read again on the next frame:
   * by then there may be a label to read it from.
   */
  function readSpacing(): void {
    const label = (options.root ?? element).querySelector(".tl-label > div");
    const next = textSpacingOf(doc.defaultView, label ?? element);
    spacingStale = label === null && next !== undefined;
    if (sameSpacing(next, spacing)) return;
    spacing = next;
    measure = next === undefined ? measured : spacedMeasure(measured ?? estimateTextWidth, next);
  }

  /** The function a fetched source calls: the latest one the host gave. */
  let fetcher: Extract<TimelineConfig<T>["items"], (...args: never[]) => unknown> | undefined;

  function useSource(source: TimelineConfig<T>["items"]): void {
    // New items from the host: a live layout no longer says anything about them.
    live = undefined;
    liveLayout = undefined;
    stopLoader?.();
    loader?.destroy();
    stopLoader = undefined;
    loader = undefined;
    if (typeof source === "function") {
      fetcher = source;
      // Through the latest function: a host that writes the fetch into its
      // render hands over a new one each time, and that is no reload.
      loader = createItemLoader<T>({ source: (range, signal) => (fetcher as typeof source)(range, signal) });
      stopLoader = loader.subscribe(() => {
        items = readableItems((loader as ItemLoader<T>).items, report);
        emitter.emit("itemsChanged", { items });
        loop.request();
      });
      items = readableItems(loader.items, report);
    } else {
      items = readableItems(source ?? [], report);
    }
    emitter.emit("itemsChanged", { items });
  }

  function machineFor(): InputMachine<T> {
    const interactions = config.interactions ?? {};
    const edit = config.editing ?? {};
    const hidden = hiddenDatesOf(config);
    return createInputMachine<T>({
      ...(hidden === undefined ? {} : { hiddenDates: hidden }),
      domain,
      mainSize: Math.max(1, view?.mainSize ?? 1),
      crossSize: Math.max(1, view?.crossSize ?? 1),
      orientation: view?.orientation ?? "horizontal",
      ...(config.limits === undefined ? {} : { limits: config.limits }),
      ...(interactions.dragThreshold === undefined ? {} : { dragThreshold: interactions.dragThreshold }),
      ...(interactions.pan === undefined ? {} : { pan: interactions.pan }),
      ...(interactions.zoom === undefined ? {} : { zoom: interactions.zoom }),
      ...(config.touchAction === undefined ? {} : { touchAction: config.touchAction }),
      editing: {
        enabled: edit.enabled === true,
        ...(interactions.moveTrigger === undefined ? {} : { moveTrigger: interactions.moveTrigger }),
        ...(interactions.longPressMs === undefined ? {} : { longPressMs: interactions.longPressMs }),
        ...(edit.snapMs === undefined ? {} : { snapMs: edit.snapMs }),
        // Read when it is asked, from the configuration as it is then: a new
        // function with the same rules is not a new machine.
        ...(edit.canMove === undefined ? {} : { canMove: (item: Item<T>, next: ItemPatch<T>) => config.editing?.canMove?.(item, next) ?? true }),
        ...(edit.multiSelect === undefined ? {} : { multiSelect: edit.multiSelect }),
        ...(edit.crossLane === undefined ? {} : { crossLane: edit.crossLane }),
        ...(edit.snapOrigin === undefined ? {} : { snapOrigin: toTimeMs(edit.snapOrigin) }),
        ...(edit.minDurationMs === undefined ? {} : { minDurationMs: edit.minDurationMs }),
        ...zoneOf(),
      },
    });
  }

  useSource(config.items);
  let machine = machineFor();
  machine.setSelection(selectedIds);
  const loop: FrameLoop = createFrameLoop(element, draw);
  let binding: InputBinding = attachInput(element, { machine, onEffects: handle, direction: () => direction });
  element.addEventListener("pointerdown", onPress, true);
  element.addEventListener("pointerup", onRelease, true);
  element.addEventListener("pointermove", onHover);
  element.addEventListener("pointerleave", onHover);
  element.addEventListener("keydown", onKey);
  element.addEventListener("dragover", onDragOver);
  element.addEventListener("drop", onDrop);

  /** The view's scale — in shown time, with hidden dates. */
  function scaleOf(mainSize: number): ReturnType<typeof createTimeScale> {
    return createTimeScale(domain, mainSize, hiddenDatesOf(config));
  }

  function resolve(): void {
    const next = resolveView(config, items, domain, width, measuredHeight, view, groups === undefined ? undefined : { groups, collapsed });
    const previous = view;
    view = next;
    if (previous === undefined || previous.orientation !== next.orientation || previous.density !== next.density) {
      // Another main axis, or other rows: nothing drawn so far is reusable.
      space = undefined;
    }
    machine.setOrientation(next.orientation);
    machine.resize({ mainSize: next.mainSize, crossSize: next.crossSize });
    if (previous !== undefined && previous.orientation !== next.orientation) {
      emitter.emit("orientationChanged", { orientation: next.orientation, previous: previous.orientation });
    }
    if (previous !== undefined && previous.density !== next.density) {
      emitter.emit("densityChanged", { density: next.density, previous: previous.density });
    }
  }

  /** The frame's direction, `"auto"` read from the element's computed style. Kept for the input between frames. */
  let direction: "ltr" | "rtl" = "ltr";
  function resolveDirection(): "ltr" | "rtl" {
    if (config.direction !== "auto") return config.direction === "rtl" ? "rtl" : "ltr";
    return doc.defaultView?.getComputedStyle(element).direction === "rtl" ? "rtl" : "ltr";
  }

  function frameState(at: ResolvedView): FrameState<T> {
    direction = resolveDirection();
    if (spacingStale) readSpacing();
    return {
      direction,
      items,
      domain,
      view: at,
      selectedIds,
      focusedId: machine.focusedId,
      crossOffset: machine.crossOffset,
      loading: loader?.loading ?? [],
      ...(measure === undefined ? {} : { measureText: measure }),
      ...(groups === undefined ? {} : { groups, collapsed }),
    };
  }

  /**
   * The view as one exact picture — not the drawn space with its overscan —
   * with an `auto` theme pinned to what the screen shows.
   */
  /** What every export says before the first frame. */
  function nothingDrawn(): Error {
    return new Error("Nothing drawn yet to export: export after the first frame, once timeline.result is set");
  }

  /**
   * One asynchronous export, run now: a missing plugin and an empty frame
   * reject its promise, as its own failure would — a method that returns a
   * promise does not also throw.
   */
  function exported<R>(what: string, run: (exporter: ReturnType<typeof plugin<"export">>, at: FrameState<T>) => R | Promise<R>): Promise<R> {
    return new Promise<R>((resolve) => {
      const exporter = plugin("export", what);
      if (result === undefined || view === undefined) throw nothingDrawn();
      resolve(run(exporter, frameState(view)));
    });
  }

  function exportScene(): SceneElement | undefined {
    if (result === undefined || view === undefined) return undefined;
    const state = frameState(view);
    const theme = exportTheme(config.theme, doc.defaultView);
    const pinned = theme === config.theme ? config : { ...config, theme };
    // The live frame's stylesheet is the shadow root's (`:host`): a file is drawn again.
    const frame = space === undefined && pinned === config && !inShadow ? result : renderTimeline(frameOptions(pinned, state));
    return frameScene(pinned, state, frame);
  }

  /** The lane a cross position is in, a group's header row counting as the group. */
  function laneAt(cross: number): string | undefined {
    const lane = tester?.laneAt(cross);
    return lane === undefined ? undefined : (pluginIf("groups")?.headerGroupId(lane) ?? pluginIf("resources")?.loadLaneOf(lane) ?? lane);
  }

  function drawGroups(frame: RenderResult<T>, at: ResolvedView): void {
    if (groups === undefined) {
      groupLayer?.destroy();
      groupLayer = undefined;
      return;
    }
    const shown = groups;
    const tree = plugin("groups", "The groups option");
    groupLayer ??= tree.mount(options.root ?? element, doc, {
      groups: () => groups ?? [],
      rows: () => groupViewOf(groups ?? [], items, collapsed).rows,
      layout: () => result?.layout,
      orientation: () => view?.orientation ?? "horizontal",
      crossOffset: () => machine.crossOffset,
      direction: () => direction,
      nonce,
      toggle: (id, next) => {
        instance.toggleGroup(id, next === undefined ? {} : { collapsed: next });
      },
      command: (command) => {
        groups = tree.applyGroupPatches(groups ?? [], command.after);
        emitter.emit("groupMoved", { command });
        loop.request();
      },
    });
    const rows = groupViewOf(shown, items, collapsed).rows;
    groupLayer.update(
      tree.groupLayerAttrs(at.orientation, at.density, config.theme, config.strings === undefined ? undefined : wordsOf(config).say("groups"), direction, at.metrics),
      tree.headerPlacements(rows, frame.layout, at.orientation, machine.crossOffset, groupLayer.focusedId, direction),
    );
  }

  /** The zone a day grid lies in: the timeline's own, so a day snaps to its midnight all year. */
  function zoneOf(): { readonly timeZone?: string } {
    return config.timeZone === undefined ? {} : { timeZone: config.timeZone };
  }

  function addOptions(): { readonly snapMs?: number; readonly snapOrigin?: TimeMs; readonly timeZone?: string } {
    const edit = config.editing ?? {};
    return {
      ...(edit.snapMs === undefined ? {} : { snapMs: edit.snapMs }),
      ...(edit.snapOrigin === undefined ? {} : { snapOrigin: toTimeMs(edit.snapOrigin) }),
      ...zoneOf(),
    };
  }

  function allowed(what: "add" | "remove" | "drop"): boolean {
    const edit = config.editing;
    // A fetched source owns its items: an add would be gone at the next window.
    const on = what === "add" ? edit?.add : what === "remove" ? edit?.remove : edit?.drop;
    return edit?.enabled === true && on === true && loader === undefined;
  }

  /** The keyboard's lane: the focused item's, else the first group's. */
  function focusedLane(): string | null {
    const id = machine.focusedId;
    const placed = id === null ? undefined : result?.layout.items.find((each) => each.item.id === id);
    if (placed !== undefined) return placed.laneId === "" ? null : placed.laneId;
    const first = groups === undefined ? undefined : groupViewOf(groups, items, collapsed).rows[0];
    return first === undefined ? null : (first.laneId ?? first.group.id);
  }

  /** The one place an add becomes a command — for a tap, a key, a drop and `dropItem` alike. */
  function commitAdd(item: Item<T> | undefined): boolean {
    if (item === undefined) return false;
    const edit = config.editing ?? {};
    const { addCommand } = plugin("items", "Adding an item");
    const command = addCommand(items, item, edit.canAdd === undefined ? {} : { canAdd: edit.canAdd });
    if (command === undefined) return false;
    apply(command.after);
    emitter.emit("itemsAdded", { items: [item], command });
    emitter.emit("command", { command });
    setSelection([item.id]);
    machine.setFocus(item.id);
    loop.request();
    return true;
  }

  /** A new item's label: "New item", or the dictionary's. */
  function newItemLabel(): string | undefined {
    return config.strings === undefined ? undefined : wordsOf(config).say("newItem");
  }

  function addAt(target: AddTarget): boolean {
    const { itemForTarget } = plugin("items", "The editing.add option");
    return commitAdd(itemForTarget(items, target, config.editing?.createItem, newItemLabel()));
  }

  /** The one place a removal becomes a command — for the remove handle and the key alike. */
  function commitRemove(id: string): boolean {
    const edit = config.editing ?? {};
    const { removeTargets, removeCommand } = plugin("items", "The editing.remove option");
    const ids = removeTargets(id, selectedIds, { multiSelect: edit.multiSelect === true });
    const removed = items.filter((item) => ids.includes(item.id));
    const command = removeCommand(items, ids, edit.canRemove === undefined ? {} : { canRemove: edit.canRemove });
    if (command === undefined) return false;
    apply(command.after);
    if (machine.focusedId !== null && ids.includes(machine.focusedId)) machine.setFocus(null);
    setSelection(selectedIds.filter((each) => !ids.includes(each)));
    emitter.emit("itemsRemoved", { items: removed, command });
    emitter.emit("command", { command });
    loop.request();
    return true;
  }

  /** Where a client point is, along and across the time axis. */
  function pointOf(event: { readonly clientX: number; readonly clientY: number }): { main: number; cross: number } {
    const box = element.getBoundingClientRect();
    // Mirrored, `x` runs from the right edge, as the drawing's does.
    const x = direction === "rtl" ? box.right - event.clientX : event.clientX - box.left;
    const y = event.clientY - box.top;
    return view?.orientation === "vertical" ? { main: y, cross: x } : { main: x, cross: y };
  }

  /** Whether an event began inside the group tree, which handles its own. */
  function fromTree(event: Event): boolean {
    const origin = event.composedPath()[0];
    return origin instanceof Element && origin.closest(".tl-groups") !== null;
  }

  function onPress(event: Event): void {
    const origin = event.composedPath()[0];
    pressTarget = origin instanceof Element ? origin : undefined;
  }

  /** The release a tap ends with: `itemClick`'s `originalEvent`, its modifier keys with it. */
  let releaseEvent: PointerEvent | undefined;
  function onRelease(event: PointerEvent): void {
    releaseEvent = event;
  }

  /** The item a mouse or pen is over, for `itemHover`: said when it changes, `null` once it left every item. */
  let hovered: string | null = null;
  function onHover(event: PointerEvent): void {
    if (event.pointerType === "touch" || destroyed) return;
    let item: Item<T> | undefined;
    if (event.type === "pointermove" && view !== undefined) {
      const box = element.getBoundingClientRect();
      // As the tools layer reads a pointer: `x` from the right in a mirrored frame.
      const x = direction === "rtl" ? box.right - event.clientX : event.clientX - box.left;
      const y = event.clientY - box.top;
      item = tester?.hitTest(view.orientation === "vertical" ? { main: y, cross: x } : { main: x, cross: y }, event.pointerType === "pen" ? "pen" : "mouse")?.item;
    }
    const id = item?.id ?? null;
    if (id === hovered) return;
    hovered = id;
    emitter.emit("itemHover", { item: item ?? null, originalEvent: event });
  }

  /** `[` and `]` along a dependency, once a Gantt chart asks for them: they remember where the last press landed. */
  let dependencyKeys: ReturnType<GanttFeature["keys"]> | undefined;

  function onKey(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.isComposing || fromTree(event) || editing) return;
    const sample = {
      key: event.key,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      time: event.timeStamp,
    };
    if (config.gantt !== undefined) {
      dependencyKeys ??= plugin("gantt", "The gantt option").keys();
      // An arrow takes no pointer: `[` and `]` move focus, and nothing else.
      const along = dependencyKeys(config as TimelineConfig<unknown>, sample, machine.focusedId, (id) => instance.focusItem(id));
      if (along !== undefined) {
        if (along) event.preventDefault();
        return;
      }
    }
    // Adding and removing are the `/items` plugin's; without it no key here means anything.
    const feature = pluginIf("items");
    if (feature === undefined) return;
    const { resolveItemKey, addTargetFromFocus } = feature;
    const action = resolveItemKey(sample);
    if (action === "add" && allowed("add")) {
      if (addAt(addTargetFromFocus(domain, focusedLane(), addOptions()))) event.preventDefault();
    } else if (action === "remove" && allowed("remove")) {
      const id = machine.focusedId ?? selectedIds[0];
      if (id !== undefined && commitRemove(id)) event.preventDefault();
    }
  }

  function onDragOver(event: DragEvent): void {
    if (!allowed("drop")) return;
    const { DROP_MIME } = plugin("items", "The editing.drop option");
    if (event.dataTransfer?.types.includes(DROP_MIME) !== true) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  function onDrop(event: DragEvent): void {
    if (!allowed("drop")) return;
    const { DROP_MIME } = plugin("items", "The editing.drop option");
    const payload = event.dataTransfer?.getData(DROP_MIME);
    if (payload === undefined || payload === "" || view === undefined) return;
    event.preventDefault();
    dropAt(payload, event);
  }

  /** The one place a drop becomes an add — HTML drag and drop and `dropItemAt` alike. */
  function dropAt(payload: string, at: { readonly clientX: number; readonly clientY: number }): boolean {
    if (view === undefined) return false;
    const { addTargetAt, itemFromDrop } = plugin("items", "The editing.drop option");
    const target = addTargetAt(pointOf(at), scaleOf(view.mainSize), laneAt, addOptions());
    return commitAdd(itemFromDrop(items, payload, target, newItemLabel()));
  }

  let slotMap: ReadonlyMap<string, ItemSlot<T>> = new Map();
  const slotItems = new WeakMap<Layout<T>, Map<string, Item<T>>>();
  /** Each drawn item's content host: one element for as long as the item is drawn. */
  const slotHosts = new Map<string, HTMLElement>();

  /**
   * The slots this frame drew. The box over an item is the scene's, and a
   * zoom builds new tiles with new boxes, a pan hands a pooled box to
   * another item — so what a framework renders into is not the box but a
   * host of the item's own, moved into whichever box the frame drew for
   * it. A portal into the host then keeps its state through every redraw
   * while the item is in view, and the slots are announced only when the
   * items drawn are others.
   */
  function collectSlots(layout: Layout<T>): void {
    const on = slotsOn(config);
    if (!on && slotMap.size === 0) return;
    const next = new Map<string, ItemSlot<T>>();
    if (on) {
      let byId = slotItems.get(layout);
      if (byId === undefined) {
        byId = new Map(layout.items.map((placed) => [placed.item.id, placed.item]));
        slotItems.set(layout, byId);
      }
      for (const box of (options.root ?? element).querySelectorAll<HTMLElement>("[data-tl-slot]")) {
        const item = byId.get(box.getAttribute("data-tl-slot") as string);
        if (item === undefined) continue;
        let host = slotHosts.get(item.id);
        if (host === undefined) {
          host = doc.createElement("div");
          host.className = "tl-slot-content";
          host.setAttribute("data-tl-content", item.id);
          host.style.cssText = "width:100%;height:100%";
          slotHosts.set(item.id, host);
        }
        if (host.parentNode !== box) box.append(host);
        next.set(item.id, { element: host, item });
      }
    }
    // A host whose item is not drawn leaves the box it was in: that box may
    // be handed to another item.
    for (const [id, host] of slotHosts) {
      if (!next.has(id)) {
        host.remove();
        slotHosts.delete(id);
      }
    }
    let same = next.size === slotMap.size;
    if (same) {
      for (const [id, slot] of next) {
        const was = slotMap.get(id);
        if (was?.element !== slot.element || was.item !== slot.item) {
          same = false;
          break;
        }
      }
    }
    if (same) return;
    slotMap = next;
    emitter.emit("slotsChanged", { slots: next });
  }

  function draw(): void {
    if (destroyed || width <= 0 || view === undefined) {
      return;
    }
    loader?.request(domain);
    // The first frame's space is the server's (`initialSpace`): no space
    // yet, at rest, plans exactly that.
    space = usesSceneSpace(config) ? planSceneSpace(space, { domain, mainSize: view.mainSize }, plan()) : undefined;
    const base = { ...frameState(view), ...(space === undefined ? {} : { space }), ...(inShadow ? { host: true } : {}) };
    const layout = liveLayoutFor(base, view);
    const state = layout === undefined ? base : { ...base, layout };
    result = renderTimeline(frameOptions(config, state));
    mount.update(frameScene(config, state, result));
    collectSlots(result.layout);
    drawGroups(result, view);
    const metrics = metricsOf(view);
    tester = createHitTester({
      layout: result.layout,
      scale: scaleOf(view.mainSize),
      crossInset: metrics.axisSize,
      crossOffset: machine.crossOffset,
      minItemMainSize: metrics.minItemMainSize,
      density: view.density,
      clusters: result.clusters,
    });
    machine.resize({ contentCrossSize: result.contentCrossSize });
    if (config.editing?.enabled === true) {
      machine.setEditing({ hitTest: tester.hitTest, lookup: tester.lookup, laneAt });
    }
    machine.setKeyboard({
      // A header row is not a lane an item can be moved into.
      navigator: createNavigator(
        keyboardLayout(result.layout),
        { crossInset: metrics.axisSize, clustering: keyboardClustering(result.clustering, keyboardLayout(result.layout)) },
      ),
    });
    publish(result);
    drawTools();
    // At rest the space fills its overscan a strip per frame: if planning
    // again says something else, there is more to draw before a pan is free.
    if (space !== undefined && plan().settle && planSceneSpace(space, { domain, mainSize: view.mainSize }, plan()) !== space) {
      loop.request();
    }
    // After a stepped re-anchor the old scale stands in for what is not
    // drawn yet; the refill is a budget of tiles a frame, until none is left.
    if (result.pendingTiles > 0) {
      loop.request();
    }
  }

  /**
   * The layout for a frame after live changes: the last frame's, with the
   * lanes the changes touched packed again (`relayout`) — when the frame
   * lays out what the changes led to, from what the last frame laid out, in
   * the same lanes and metrics. Anything else is laid out by the renderer.
   */
  function liveLayoutFor(state: FrameState<T>, at: ResolvedView): Layout<T> | undefined {
    const content = contentOf(config, state);
    const key = `${config.packMode ?? ""}|${config.timeZone ?? ""}|${at.density}|${at.orientation}`;
    const previous = lastFrame;
    const pending = live;
    lastFrame = { items: content.items, lanes: content.lanes, key };
    live = undefined;
    if (previous === undefined || previous.lanes !== content.lanes || previous.key !== key) {
      liveLayout = undefined;
      return undefined;
    }
    if (liveLayout !== undefined && liveLayout.items === content.items) return liveLayout.layout;
    liveLayout = undefined;
    if (pending === undefined || result === undefined || previous.items !== pending.from || content.items !== pending.to) return undefined;
    const metrics = sizesOf(at);
    const layout = relayout(result.layout, content.items, pending.touched, {
      ...(content.lanes === undefined ? {} : { lanes: content.lanes }),
      ...(config.packMode === undefined ? {} : { packMode: config.packMode }),
      ...(config.timeZone === undefined ? {} : { timeZone: config.timeZone }),
      metrics: { rowSize: metrics.rowSize, rowGap: metrics.rowGap, laneGap: metrics.laneGap },
    });
    liveLayout = { items: content.items, layout };
    return layout;
  }

  /** The one place a live change lands — for every method of it. */
  function commitLive(changes: ItemChanges<T>): void {
    if (destroyed) return;
    if (loader !== undefined) throw new TypeError("Live changes need an items array: a fetched source's items are its own");
    const applied = applyItemChanges(items, changes);
    if (applied.added.length === 0 && applied.updated.length === 0 && applied.removed.length === 0) return;
    const next = readableItems(applied.items, report);
    requireKinds(readableItems([...applied.added, ...applied.updated]));
    const lanes = new Set(live?.touched ?? []);
    for (const lane of applied.lanes) lanes.add(lane);
    live = { from: live?.from ?? items, to: next, touched: lanes };
    items = next;
    const gone = new Set(applied.removed.map((item) => item.id));
    if (gone.size > 0) {
      if (machine.focusedId !== null && gone.has(machine.focusedId)) machine.setFocus(null);
      if (selectedIds.some((id) => gone.has(id))) setSelection(selectedIds.filter((id) => !gone.has(id)));
    }
    emitter.emit("itemsChanged", { items });
    if (width > 0) resolve();
    loop.request();
  }

  // --- the time tools -------------------------------------------------------

  /** The one place a time bar moves — for a drag and a key alike. */
  function commitTimeBar(id: string, time: TimeMs): void {
    const settings = config.timeBarOptions ?? {};
    const limits = config.limits;
    const { moveTimeBar } = plugin("tools", "The timeBars option");
    const moved = moveTimeBar(bars, id, time, {
      ...(settings.snapMs === undefined ? {} : { snapMs: settings.snapMs }),
      ...zoneOf(),
      ...(limits?.min === undefined && limits?.max === undefined
        ? {}
        : { limits: [limits.min === undefined ? -8.64e15 : toTimeMs(limits.min), limits.max === undefined ? 8.64e15 : toTimeMs(limits.max)] as const }),
    });
    if (moved === undefined) return;
    bars = moved.bars;
    emitter.emit("timeBarMoved", moved.moved);
    loop.request();
  }

  /** The view a tool moved to: the strip's window, a preset. The reader's move — the clock lets go. */
  function moveView(next: Domain, why: ViewportChangeReason): void {
    machine.setDomain(next);
    domain = machine.domain;
    reason = why;
    touched = true;
    following = false;
    loop.request();
  }

  function presetsOf(): readonly ZoomPreset[] | undefined {
    const setting = config.zoomPresets;
    if (setting === undefined || setting === false) return undefined;
    if (setting !== true) return setting;
    const { DEFAULT_ZOOM_PRESETS } = plugin("tools", "The zoomPresets option");
    if (config.strings === undefined) return DEFAULT_ZOOM_PRESETS;
    // The default presets, named in the dictionary's words: zoomDay, zoomWeek, …
    const say = wordsOf(config).say;
    return DEFAULT_ZOOM_PRESETS.map((preset) => ({ ...preset, label: say(PRESET_WORDS[preset.id] ?? "zoom") }));
  }

  function rangeOf(): (NonNullable<Exclude<TimelineConfig<T>["rangeSelect"], boolean>>) | undefined {
    const setting = config.rangeSelect;
    if (setting === undefined || setting === false) return undefined;
    const snapMs = config.editing?.snapMs;
    return { ...zoneOf(), ...(setting === true ? (snapMs === undefined ? {} : { snapMs }) : setting) };
  }

  /** An item's box in the element, along and across. */
  function boxOf(id: string): MainCrossRect | undefined {
    const placed = result?.layout.items.find((each) => each.item.id === id);
    if (placed === undefined || view === undefined) return undefined;
    const rect = itemRect(placed, scaleOf(view.mainSize));
    return { ...rect, cross: rect.cross + metricsOf(view).axisSize - machine.crossOffset };
  }

  function defaultTip(item: Item<T>): string {
    const locale = config.locale ?? "en";
    const timeZone = config.timeZone ?? "UTC";
    const medium = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone });
    // Before year 1 a date without its era reads as AD.
    const bc = new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric", era: "short", hour: "numeric", minute: "2-digit", timeZone });
    const format = { format: (time: number): string => (time < -62_135_596_800_000 ? bc : medium).format(time) };
    const start = toTimeMs(item.start);
    const when =
      item.end === undefined
        ? format.format(start)
        : config.strings === undefined
          ? `${format.format(start)} – ${format.format(toTimeMs(item.end))}`
          : wordsOf(config).say("range", { start: format.format(start), end: format.format(toTimeMs(item.end)) });
    return `${item.label ?? item.id}\n${when}`;
  }

  /** Whether the drawing — not one of the tools — has the keyboard's focus. */
  function drawingFocused(): boolean {
    const root = options.root ?? element;
    const active = root instanceof ShadowRoot ? root.activeElement : doc.activeElement;
    if (active === null) return false;
    if (active.closest(".tl-tools, .tl-groups") !== null) return false;
    return active === element || root.contains(active);
  }

  const toolsHost: ToolsHost<T> = {
    element,
    nonce,
    orientation: () => view?.orientation ?? "horizontal",
    frame: () => (view === undefined ? undefined : { mainSize: view.mainSize, crossSize: view.crossSize, axisSize: metricsOf(view).axisSize, band: view.band }),
    domain: () => domain,
    scale: () => (view === undefined || view.mainSize <= 0 ? undefined : scaleOf(view.mainSize)),
    locale: () => config.locale ?? "en",
    timeZone: () => config.timeZone ?? "UTC",
    bars: () => bars,
    barStep: () => config.timeBarOptions?.stepMs ?? plugin("tools", "The timeBars option").defaultTimeBarStep(domain, config.timeBarOptions?.snapMs),
    moveBar: (id, time) => {
      commitTimeBar(id, time);
    },
    geometry: () => (result === undefined || view === undefined ? undefined : minimapGeometryOf(config, frameState(view), result)),
    setDomain: (next) => {
      moveView(next, "pan");
    },
    range: rangeOf,
    selectRange: (range) => {
      emitter.emit("rangeSelected", range);
    },
    presets: presetsOf,
    zoomToPreset: (id) => {
      instance.zoomToPreset(id);
    },
    tooltips: () => config.tooltip !== undefined && config.tooltip !== false,
    tooltip: (item) => (typeof config.tooltip === "function" ? config.tooltip(item) : defaultTip(item)),
    hitAt: (point, pointerType) => {
      const hit = tester?.hitTest(point, pointerType);
      const box = hit === undefined ? undefined : boxOf(hit.item.id);
      return hit === undefined || box === undefined ? undefined : { item: hit.item, box };
    },
    focused: () => {
      const id = machine.focusedId;
      if (id === null || !drawingFocused()) return undefined;
      const item = itemById(id);
      const box = boxOf(id);
      return item === undefined || box === undefined ? undefined : { item, box };
    },
    editing: () => editing,
    direction: () => direction,
    say: (key, values) => wordsOf(config).say(key, values),
  };

  function drawTools(): void {
    const on =
      bars.length > 0 || (view?.band ?? 0) > 0 || rangeOf() !== undefined || presetsOf() !== undefined || (config.tooltip !== undefined && config.tooltip !== false);
    if (!on) {
      toolsLayer?.destroy();
      toolsLayer = undefined;
      return;
    }
    toolsLayer ??= plugin("tools", "The time tools").mount(options.root ?? element, doc, toolsHost);
    toolsLayer.update();
  }

  /** Follow the clock, when `rolling` says so: now, and every `intervalMs`. */
  function startRolling(): void {
    if (rollTimer !== undefined) clearInterval(rollTimer);
    rollTimer = undefined;
    const settings = rollingOf(config);
    if (settings === undefined) return;
    const { rollingDomain } = plugin("tools", "The rolling option");
    const step = (): void => {
      if (!following || gesture || editing || destroyed) return;
      const next = rollingDomain(domain, Date.now(), settings, hiddenDatesOf(config));
      machine.setDomain(next);
      domain = machine.domain;
      reason = "api";
      loop.request();
    };
    step();
    rollTimer = setInterval(step, settings.intervalMs ?? 1000);
  }

  function plan(): { readonly settle: boolean; readonly levels: true; readonly overscan?: number } {
    return { settle: !gesture && !coasting, levels: true, ...(touched ? {} : { overscan: 0 }) };
  }

  function stopCoasting(): void {
    coasting = false;
    if (coastTimer !== undefined) clearTimeout(coastTimer);
    coastTimer = undefined;
  }

  function coast(): void {
    coasting = true;
    if (coastTimer !== undefined) clearTimeout(coastTimer);
    coastTimer = setTimeout(() => {
      coastTimer = undefined;
      coasting = false;
      loop.request();
    }, COAST_MS);
  }

  /**
   * Items on screen. Without a space that is the frame's own count; in one,
   * the frame also holds what is drawn ahead in the overscan, so count the
   * items in the view — with the renderer's culling margin of a row — instead.
   */
  function visibleCountOf(frame: RenderResult<T>, at: ResolvedView): number {
    if (space === undefined) return frame.visibleCount;
    // The renderer's own culling (`drawExactItems`, `crossBoxOf`), in time:
    // a row's width of margin along the axis, a row past the far edge across.
    const metrics = sizesOf(at);
    const msPerPx = frame.viewport.msPerPx;
    const low = domain[0] - metrics.rowSize * msPerPx;
    const high = domain[1] + metrics.rowSize * msPerPx;
    const minMs = metrics.minItemMainSize * msPerPx;
    const scroll = machine.crossOffset;
    const far = at.crossSize + metrics.rowSize - metrics.axisSize;
    let count = 0;
    for (const placed of frame.layout.items) {
      const { start, end } = placed.span;
      if (
        start + Math.max(end - start, minMs) > low &&
        start < high &&
        placed.cross + placed.crossSize - scroll > 0 &&
        placed.cross - scroll < far
      ) {
        count += 1;
      }
    }
    return count;
  }

  function publish(frame: RenderResult<T>): void {
    const viewport = frame.viewport;
    const visibleCount = view === undefined ? frame.visibleCount : visibleCountOf(frame, view);
    if (
      lastViewport === undefined ||
      lastViewport.domain[0] !== viewport.domain[0] ||
      lastViewport.domain[1] !== viewport.domain[1] ||
      lastViewport.mainSize !== viewport.mainSize ||
      lastViewport.crossSize !== viewport.crossSize ||
      lastViewport.orientation !== viewport.orientation ||
      lastViewport.density !== viewport.density
    ) {
      lastViewport = viewport;
      emitter.emit("viewportChanged", { viewport, reason });
    }
    reason = "api";
    const layoutKey = `${String(frame.layout.lanes.length)}|${String(visibleCount)}|${String(frame.contentCrossSize)}`;
    if (layoutKey !== lastLayout) {
      lastLayout = layoutKey;
      emitter.emit("layoutChanged", {
        laneCount: frame.layout.lanes.length,
        visibleItemCount: visibleCount,
        crossSize: frame.contentCrossSize,
      });
    }
    const next: TimelineSnapshot = {
      domain,
      viewport,
      orientation: viewport.orientation,
      density: viewport.density,
      selectedIds,
      focusedId: machine.focusedId,
      visibleCount,
      busy: loader?.busy ?? false,
      editing,
      crossOffset: machine.crossOffset,
    };
    const before = snapshot;
    if (
      before.viewport !== undefined &&
      before.domain[0] === next.domain[0] &&
      before.domain[1] === next.domain[1] &&
      before.selectedIds === next.selectedIds &&
      before.focusedId === next.focusedId &&
      before.visibleCount === next.visibleCount &&
      before.busy === next.busy &&
      before.editing === next.editing &&
      before.crossOffset === next.crossOffset &&
      before.orientation === next.orientation &&
      before.density === next.density &&
      before.viewport.mainSize === viewport.mainSize &&
      before.viewport.crossSize === viewport.crossSize
    ) {
      // Nothing a framework renders from changed: the same object, so
      // `useSyncExternalStore` bails out without a render.
      return;
    }
    snapshot = Object.freeze(next);
    for (const listener of [...listeners]) {
      listener();
    }
  }

  function setSelection(ids: readonly string[]): void {
    if (ids.length === selectedIds.length && ids.every((id, index) => selectedIds[index] === id)) {
      return;
    }
    const previousIds = selectedIds;
    selectedIds = [...ids];
    machine.setSelection(selectedIds);
    syncSnapshot();
    emitter.emit("selectionChanged", { ids: selectedIds, previousIds });
  }

  /**
   * The selection and the focus in the snapshot at once, not at the next
   * frame: a `selectionChanged` listener that reads `getSnapshot()` (or the
   * element's `selectedIds`), or a caller right after `focusItem`, gets the
   * change, not the last frame's state. The next frame's snapshot then says
   * the same, so it notifies nobody twice.
   */
  function syncSnapshot(): void {
    if (snapshot.selectedIds === selectedIds && snapshot.focusedId === machine.focusedId) return;
    snapshot = Object.freeze({ ...snapshot, selectedIds, focusedId: machine.focusedId });
    for (const listener of [...listeners]) {
      listener();
    }
  }

  function choose(id: string | null): void {
    if (id === null) {
      setSelection([]);
    } else if (config.editing?.multiSelect !== true) {
      setSelection([id]);
    } else {
      setSelection(selectedIds.includes(id) ? selectedIds.filter((each) => each !== id) : [...selectedIds, id]);
    }
  }

  function apply(patches: readonly ItemPatch[]): void {
    if (loader !== undefined) {
      loader.apply(patches);
      items = loader.items;
    } else {
      // Adds and removes are patches too (`item`), the `/items` plugin's; the rest is `applyPatches`.
      items = patches.some((patch) => "item" in patch) ? plugin("items", "A command that adds or removes items").applyItemPatches(items, patches) : applyPatches(items, patches);
    }
    emitter.emit("itemsChanged", { items });
  }

  function itemById(id: string): Item<T> | undefined {
    return items.find((item) => item.id === id);
  }

  function openCluster(cluster: Cluster<T>, anchor?: number): void {
    if (view === undefined) return;
    const zoom = clusterZoom(cluster, scaleOf(view.mainSize), anchor === undefined ? {} : { anchor });
    emitter.emit("clusterOpened", { cluster });
    handle(machine.zoom(zoom.factor, zoom.anchor));
  }

  function schedule(effects: readonly InputEffect<T>[]): void {
    for (const effect of effects) {
      if (effect.type !== "schedule") continue;
      if (wakeUp !== undefined) clearTimeout(wakeUp);
      wakeUp = undefined;
      if (effect.at !== null && view_ !== null) {
        const now = view_.performance.now();
        wakeUp = setTimeout(() => {
          wakeUp = undefined;
          const later = machine.elapse(view_.performance.now());
          schedule(later);
          handle(later, true);
        }, Math.max(0, effect.at - now));
      }
    }
  }

  /** Effects from an API call: the binding did not see them, so their wake-ups are ours. */
  function run(effects: readonly InputEffect<T>[]): void {
    schedule(effects);
    handle(effects, true);
  }

  /**
   * `fromApi`: the effects answer a call of the host's, not a gesture, so
   * the view changed for reason `api` — the reason a host checks to ignore
   * its own calls — whatever kind of motion the machine used to get there.
   */
  function handle(effects: readonly InputEffect<T>[], fromApi = false): void {
    if (destroyed) return;
    let changed = false;
    /** A double tap that added an item: the zoom the machine paired with it is not wanted. */
    let added = false;
    if (!fromApi && effects.length > 0) touched = true;
    for (const effect of effects) {
      if (added && effect.type === "viewport" && effect.reason === "zoom") {
        added = false;
        machine.setDomain(domain);
        continue;
      }
      switch (effect.type) {
        case "viewport":
          domain = effect.domain;
          reason = fromApi ? "api" : effect.reason;
          // The reader moved the view: the clock lets go of it until `follow()`.
          if (!fromApi) following = false;
          // A key step outside a gesture (a wheel run is one): the run coasts.
          if (!fromApi && !gesture) coast();
          changed = true;
          break;
        case "tap": {
          if (effect.pointerCount !== 1 || tester === undefined) break;
          const point = { main: effect.main, cross: effect.cross };
          const cluster = tester.clusterAt(point, effect.pointerType);
          if (cluster !== undefined && effect.tapCount === 1) {
            openCluster(cluster, effect.main);
            return;
          }
          const removeId = pressTarget?.closest("[data-tl-remove]")?.getAttribute("data-tl-remove") ?? null;
          if (effect.tapCount === 1 && removeId !== null && allowed("remove")) {
            commitRemove(removeId);
            changed = true;
            break;
          }
          const hit = tester.hitTest(point, effect.pointerType);
          if (effect.tapCount === 2 && hit === undefined && allowed("add") && view !== undefined && effect.cross >= metricsOf(view).axisSize) {
            // On empty lane space a double tap adds; on the axis it still zooms.
            const { addTargetAt } = plugin("items", "The editing.add option");
            added = addAt(addTargetAt(point, scaleOf(view.mainSize), laneAt, addOptions()));
            changed = true;
            break;
          }
          if (effect.tapCount === 1) {
            choose(hit?.item.id ?? null);
            machine.setFocus(hit?.item.id ?? null);
            if (hit !== undefined) emitter.emit("itemClick", { item: hit.item, ...(releaseEvent === undefined ? {} : { originalEvent: releaseEvent }) });
          } else if (effect.tapCount === 2 && hit !== undefined) {
            emitter.emit("itemDblClick", { item: hit.item, ...(releaseEvent === undefined ? {} : { originalEvent: releaseEvent }) });
          }
          changed = true;
          break;
        }
        case "activate": {
          const cluster = effect.id === null ? undefined : result?.clustering?.byId(effect.id);
          if (cluster !== undefined) {
            openCluster(cluster);
            return;
          }
          choose(effect.id);
          const item = effect.id === null ? undefined : itemById(effect.id);
          if (item !== undefined) emitter.emit("itemClick", { item });
          changed = true;
          break;
        }
        case "focus":
          changed = true;
          break;
        case "gestureStart":
          gesture = true;
          break;
        case "gestureEnd":
          // The frame after a gesture is exact again: draw it — now, not
          // when a coast that the gesture's first step may have begun ends.
          gesture = false;
          stopCoasting();
          changed = true;
          break;
        case "jumpRequest":
          emitter.emit("jumpRequest", { time: (domain[0] + domain[1]) / 2 });
          break;
        case "editStart":
          restore = effect.items.map(restoreOf);
          editing = true;
          changed = true;
          break;
        case "editMove":
          apply(effect.patches);
          changed = true;
          break;
        case "editEnd": {
          editing = false;
          changed = true;
          if (effect.cancelled || effect.command === undefined) {
            apply(restore);
            break;
          }
          const command = effect.command;
          apply(restore);
          apply(command.after);
          for (const to of command.after) {
            const item = itemById(to.id);
            const from = command.before.find((patch) => patch.id === to.id);
            if (item === undefined || from === undefined) continue;
            emitter.emit(effect.mode === "move" ? "itemMoved" : "itemResized", { item, from, to, command });
          }
          emitter.emit("command", { command });
          break;
        }
        default:
          break;
      }
    }
    if (changed) {
      // A key that moved the focus says so in the snapshot now, not at the next frame.
      syncSnapshot();
      loop.request();
    }
  }

  const sizing: SizeObservation = observeSize(element, (size) => {
    width = size.width;
    measuredHeight = size.height;
    if (reason !== "init") reason = "resize";
    spacingStale = true;
    resolve();
    // A resize is drawn at once: waiting a frame would show the old size
    // stretched for one frame.
    loop.request();
    loop.flush();
  });

  const instance: Timeline<T> = {
    on(type, listener) {
      return emitter.on(type, listener);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot() {
      return snapshot;
    },
    update(next) {
      if (destroyed) return;
      const before = config;
      const merged = readableOptionsOf({ ...config, ...next } as TimelineConfig<T>, report);
      // Before anything changes: a configuration that throws leaves the instance as it was.
      requirePlugins(merged);
      checkMetrics(merged);
      if ("items" in next && typeof next.items !== "function") requireKinds(readableItems(next.items ?? []));
      // A value that says what the one before said is no change, and keeps
      // its identity: what is cached on it (the hidden dates' expansion)
      // stays. A component hands its props again on every render.
      for (const key of SETTLED) {
        if (key in next && sameValue(before[key], next[key])) (merged as Record<string, unknown>)[key] = before[key];
      }
      config = merged;
      const changed = (key: keyof TimelineConfig<T>): boolean => key in next && config[key] !== before[key];
      if (typeof next.items === "function" && typeof before.items === "function") {
        // Another fetch function: what was loaded stays, the next fetch is the new one's.
        fetcher = next.items;
      } else if ("items" in next && next.items !== before.items) {
        useSource(next.items);
      }
      // By what they say: groups written anew on each render keep the reader's order.
      if ("groups" in next && !sameValue(next.groups, before.groups)) {
        const known = new Set((groups ?? []).map((group) => group.id));
        groups = next.groups;
        // A group kept keeps its state; a new one starts as it says.
        collapsed = new Set(
          (groups ?? []).filter((group) => (known.has(group.id) ? collapsed.has(group.id) : group.collapsed === true)).map((group) => group.id),
        );
      }
      if (next.domain !== undefined && changed("domain") && !sameDomain(before.domain, next.domain)) {
        machine.setDomain([toTimeMs(next.domain[0]), toTimeMs(next.domain[1])]);
        domain = machine.domain;
        reason = "api";
      }
      if (changed("timeBars")) bars = next.timeBars ?? [];
      if (changed("interactions") || changed("limits") || changed("touchAction") || changed("hiddenDates") || changed("timeZone") || (changed("editing") && !sameValue(rulesOf(before.editing), rulesOf(config.editing)))) {
        // The machine reads these once; a new one starts from the current view.
        binding.destroy();
        gesture = false;
        machine = machineFor();
        machine.setSelection(selectedIds);
        binding = attachInput(element, { machine, onEffects: handle, direction: () => direction });
      }
      if (next.selectedIds !== undefined && changed("selectedIds")) {
        setSelection(next.selectedIds);
      }
      if (changed("rolling")) {
        following = rollingOf(config) !== undefined;
        startRolling();
      }
      if (width > 0) resolve();
      loop.request();
    },
    setItems(source) {
      if (destroyed) return;
      if (typeof source === "function" || source === config.items) {
        // The array it was given again: after an edit the instance holds
        // another, and this one replaces it. (`update` takes the same array
        // as no news — a host re-sending its props keeps the edits.) A fetch
        // function loads afresh, which `update` with a new one does not.
        config = { ...config, items: source };
        useSource(source);
        if (width > 0) resolve();
        loop.request();
        return;
      }
      instance.update({ items: source });
    },
    applyCommand(command) {
      if (destroyed) return;
      if (isGroupCommand(command)) {
        if (groups !== undefined) groups = plugin("groups", "A group command").applyGroupPatches(groups, command.after);
      } else {
        apply(command.after);
      }
      loop.request();
    },
    toggleGroup(id, options = {}) {
      if (destroyed) return;
      const group = groups?.find((each) => each.id === id);
      if (group === undefined) return;
      const value = options.collapsed ?? !collapsed.has(id);
      if (value === collapsed.has(id)) return;
      const changed = new Set(collapsed);
      if (value) changed.add(id);
      else changed.delete(id);
      collapsed = changed;
      emitter.emit("groupToggled", { group, collapsed: value });
      if (width > 0) resolve();
      loop.request();
    },
    dropItem(payload) {
      if (destroyed) return false;
      if (!allowed("drop")) return false;
      const { itemFromDrop, addTargetFromFocus } = plugin("items", "The editing.drop option");
      return commitAdd(itemFromDrop(items, JSON.stringify(payload), addTargetFromFocus(domain, focusedLane(), addOptions()), newItemLabel()));
    },
    dropItemAt(payload, at) {
      if (destroyed) return false;
      if (!allowed("drop")) return false;
      const box = element.getBoundingClientRect();
      if (at.clientX < box.left || at.clientX > box.right || at.clientY < box.top || at.clientY > box.bottom) return false;
      return dropAt(JSON.stringify(payload), at);
    },
    get items() {
      return items;
    },
    addItems(added) {
      if (destroyed) return;
      commitLive({ add: added });
    },
    updateItems(updates) {
      if (destroyed) return;
      commitLive({ update: updates });
    },
    removeItems(ids) {
      if (destroyed) return;
      commitLive({ remove: ids });
    },
    changeItems(changes) {
      if (destroyed) return;
      commitLive(changes);
    },
    get timeBars() {
      return bars;
    },
    zoomToPreset(id, around) {
      if (destroyed) return false;
      const preset = presetsOf()?.find((each) => each.id === id);
      if (preset === undefined) return false;
      moveView(plugin("tools", "The zoomPresets option").presetDomain(preset, domain, { ...(around === undefined ? {} : { around: toTimeMs(around) }), ...(config.timeZone === undefined ? {} : { timeZone: config.timeZone }) }), "zoom");
      return true;
    },
    follow() {
      if (destroyed) return;
      if (rollingOf(config) === undefined) return;
      following = true;
      startRolling();
    },
    zoomTo(next) {
      if (destroyed) return;
      machine.setDomain([toTimeMs(next[0]), toTimeMs(next[1])]);
      domain = machine.domain;
      reason = "api";
      loop.request();
    },
    zoomBy(factor, around) {
      if (destroyed) return;
      const scale = scaleOf(Math.max(1, view?.mainSize ?? 1));
      const anchor = around === undefined ? scale.mainSize / 2 : scale.toMain(toTimeMs(around));
      run(machine.zoom(factor, anchor));
    },
    scrollTo(time) {
      if (destroyed) return;
      run(machine.goTo(time, view_?.performance.now() ?? 0));
    },
    select(ids) {
      if (destroyed) return;
      setSelection(ids);
      loop.request();
    },
    get layout() {
      return result?.layout;
    },
    get slots() {
      return slotMap;
    },
    get metrics() {
      return view === undefined ? undefined : sizesOf(view);
    },
    focusItem(id) {
      if (destroyed) return false;
      const placed = result?.layout.items.find((each) => each.item.id === id);
      if (placed === undefined || view === undefined) return false;
      machine.setFocus(id);
      syncSnapshot();
      const { start, end } = placed.span;
      if (end <= domain[0] || start >= domain[1]) {
        run(machine.goTo(start, view_?.performance.now() ?? 0));
      }
      const lane = result?.layout.lanes.find((each) => each.lane.id === placed.laneId);
      if (lane !== undefined) instance.revealLane(lane.lane.id);
      loop.request();
      return true;
    },
    scrollLanes(delta) {
      if (destroyed) return;
      if (!Number.isFinite(delta) || delta === 0) return;
      run(machine.pan(0, delta));
    },
    revealLane(laneId) {
      if (destroyed) return;
      const lane = result?.layout.lanes.find((each) => each.lane.id === laneId);
      if (lane === undefined || view === undefined) return;
      const offset = machine.crossOffset;
      const next = revealOffset(lane, offset, view.crossSize, metricsOf(view).axisSize);
      if (next !== offset) run(machine.pan(0, next - offset));
    },
    get result() {
      return result;
    },
    exportSvg() {
      const scene = exportScene();
      if (scene === undefined) throw nothingDrawn();
      // A file of its own is XML: what XML allows nowhere (a C0 control, half
      // a surrogate pair) leaves the text, as in the core's `standaloneSvg`.
// eslint-disable-next-line no-control-regex -- these are the characters it is about
      const svg = renderToSvgString(scene).replace(/[\0-\b\v\f\x0e-\x1f\ufffe\uffff\p{Cs}]/gu, "");
      return svg.includes("xmlns=") ? svg : svg.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
    },
    exportPng(options) {
      return exported("exportPng()", (exporter) => {
        const scene = exportScene();
        if (scene === undefined) throw nothingDrawn();
        return exporter.png(doc, scene, options);
      });
    },
    exportPdf(options = {}) {
      // The pages are cut now, from the frame the call saw, not from
      // whatever is drawn when it resolves.
      return exported("exportPdf()", (exporter, at) => exporter.pdf(config, at, (result as RenderResult<T>).layout, options));
    },
    print(options = {}) {
      return exported("print()", (exporter, at) => exporter.print(doc, config, at, (result as RenderResult<T>).layout, options));
    },
    flush() {
      if (destroyed) return;
      loop.request();
      loop.flush();
    },
    get destroyed() {
      return destroyed;
    },
    get nonce() {
      return nonce;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (wakeUp !== undefined) clearTimeout(wakeUp);
      if (coastTimer !== undefined) clearTimeout(coastTimer);
      if (rollTimer !== undefined) clearInterval(rollTimer);
      if (claimedPosition) element.style.position = ownPosition;
      toolsLayer?.destroy();
      sizing.destroy();
      stopSpacingWatch();
      binding.destroy();
      element.removeEventListener("pointerdown", onPress, true);
      element.removeEventListener("pointerup", onRelease, true);
      element.removeEventListener("pointermove", onHover);
      element.removeEventListener("pointerleave", onHover);
      element.removeEventListener("keydown", onKey);
      element.removeEventListener("dragover", onDragOver);
      element.removeEventListener("drop", onDrop);
      groupLayer?.destroy();
      loop.destroy();
      stopLoader?.();
      loader?.destroy();
      mount.destroy();
      listeners.clear();
    },
  };
  // Not a plain object: a framework's deep state (Svelte's `$state`, Vue's
  // `ref`) proxies plain objects, and a bound instance would come back as a
  // proxy of itself — every read of `result` a proxy too, and a spy or a
  // property set on it never reaching the instance.
  Object.setPrototypeOf(instance, INSTANCE_PROTOTYPE);
  startRolling();
  say = (skipped) => emitter.emit("inputSkipped", skipped);
  if (skippedAtStart.length > 0) {
    queueMicrotask(() => {
      if (!destroyed) for (const skipped of skippedAtStart) emitter.emit("inputSkipped", skipped);
    });
  }
  return instance;
}

/** What every instance inherits from: `Object.prototype`, and its own name. */
const INSTANCE_PROTOTYPE: object = Object.freeze(Object.create(Object.prototype, { [Symbol.toStringTag]: { value: "Timeline" } }));

/** The rolling settings of a configuration, or `undefined` when it does not roll. */
function rollingOf<T>(config: TimelineConfig<T>): TimelineRollingOptions | undefined {
  const setting = config.rolling;
  return setting === undefined || setting === false ? undefined : setting === true ? {} : setting;
}
