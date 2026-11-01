/**
 * The public type surface of the timeline core.
 *
 * Nothing in this file emits runtime code: it is the contract that every later
 * phase has to satisfy. Two conventions are load-bearing here:
 *
 * 1. Time is epoch milliseconds (`TimeMs`) inside the engine. `Date` is
 *    accepted at the boundary and normalised once, so the hot paths never
 *    allocate.
 * 2. Geometry is expressed in `(main, cross)` space, never in `x`/`y`. `main`
 *    runs along the time axis, `cross` across the lanes. A single projector
 *    turns that into screen coordinates, which is what makes vertical
 *    timelines the same code path as horizontal ones rather than a port.
 */

/** A point in time, as epoch milliseconds. */
export type TimeMs = number;

/** Time accepted at the public boundary; normalised to {@link TimeMs} inside. */
export type TimeInput = TimeMs | Date;

/** A half-open time range `[start, end)`. */
export type Domain = readonly [start: TimeMs, end: TimeMs];

/** Which way the time axis runs on screen. */
export type Orientation = "horizontal" | "vertical";

/** Orientation as configured; `auto` resolves from the container size. */
export type OrientationSetting = Orientation | "auto";

/** How much room items and labels get. */
export type Density = "comfortable" | "compact" | "dense";

/** Density as configured; `auto` resolves from the container and pointer type. */
export type DensitySetting = Density | "auto";

/** Where item details are shown. */
export type DetailSurface = "popover" | "sheet";

/** Detail surface as configured; `auto` picks a sheet on narrow viewports. */
export type DetailSurfaceSetting = DetailSurface | "auto";

/** How overlapping items share a lane. */
export type PackMode = "pack" | "overlap" | "single";

/** The precision an item's time is known to. Drives rendering and snapping. */
export type Granularity =
  | "millisecond"
  | "second"
  | "minute"
  | "hour"
  | "day"
  | "month"
  | "year"
  | "decade"
  | "century"
  | "millennium";

/**
 * Which hardware produced a pointer event.
 *
 * Drives thresholds and target sizes, nothing else: the gesture logic is the
 * same for every kind, which is what "one pipeline" means.
 */
export type PointerKind = "mouse" | "pen" | "touch";

/** What starts a drag. `auto` resolves per gesture from the pointer type. */
export type MoveTrigger = "auto" | "long-press" | "edit-mode" | "handle";

/** A point in the orientation-independent internal space. */
export interface MainCross {
  readonly main: number;
  readonly cross: number;
}

/** A box in the orientation-independent internal space. */
export interface MainCrossRect {
  readonly main: number;
  readonly cross: number;
  readonly mainSize: number;
  readonly crossSize: number;
}

/** One entry on the timeline. `T` is the host's own payload, carried untouched. */
export interface Item<T = unknown> {
  readonly id: string;
  readonly start: TimeInput;
  /**
   * Omitted for an instant. An instant still has extent: it covers its
   * {@link Item.granularity} unit, so two events on the same day collide when
   * the day is what the host knows.
   */
  readonly end?: TimeInput;
  /**
   * The interval is ongoing or its end is unknown, so it reaches past the
   * viewport. Layout treats it as unbounded and nothing is ever packed after
   * it in the same sublane.
   */
  readonly open?: boolean;
  readonly laneId?: string;
  /**
   * How many sublanes the item is tall. One by default; a band that needs more
   * room reserves that many consecutive free sublanes.
   */
  readonly sublaneSpan?: number;
  readonly granularity?: Granularity;
  readonly label?: string;
  readonly className?: string;
  readonly selectable?: boolean;
  readonly movable?: boolean;
  readonly resizable?: boolean;
  /** `false` keeps the item from being deleted from the timeline. */
  readonly removable?: boolean;
  /**
   * How the item is drawn. `range` (the default) is a bar over its span;
   * `box` and `point` are drawn with a line to the axis, and `background` is
   * a band behind every lane that nothing can hit. Only the renderer hooks of
   * `@temporeum/timeline-core/items` read it: the base entry point draws every
   * kind as a range.
   */
  readonly kind?: ItemKind;
  /**
   * How much of the work is done, from 0 to 1. Drawn as the filled part of
   * the bar by the renderer hooks of `@temporeum/timeline-core/gantt`.
   */
  readonly progress?: number;
  /**
   * The span the plan promised, drawn as a thin bar under the item by the
   * `@temporeum/timeline-core/gantt` hooks, so a slip is a visible gap.
   */
  readonly baseline?: { readonly start: TimeInput; readonly end?: TimeInput };
  readonly data?: T;
}

/**
 * How an item is drawn. See {@link Item.kind}. A `milestone` is a diamond at
 * its start, drawn by the `@temporeum/timeline-core/gantt` hooks.
 */
export type ItemKind = "range" | "box" | "point" | "background" | "milestone";

/** A horizontal row (or vertical column) items are packed into. */
export interface Lane {
  readonly id: string;
  readonly label?: string;
  /** Pinned lanes keep their cross position when the rest scrolls. */
  readonly pinned?: boolean;
  readonly packMode?: PackMode;
  readonly minCrossSize?: number;
  readonly collapsed?: boolean;
}

/** The resolved, observable view state. */
export interface Viewport {
  readonly domain: Domain;
  readonly orientation: Orientation;
  readonly density: Density;
  /** Container extent along the time axis, in CSS pixels. */
  readonly mainSize: number;
  /** Container extent across the lanes, in CSS pixels. */
  readonly crossSize: number;
  /** Milliseconds per pixel along the main axis. The zoom level, measurably. */
  readonly msPerPx: number;
}

/** Hard bounds the viewport may never leave. */
export interface DomainLimits {
  readonly min?: TimeInput;
  readonly max?: TimeInput;
  /** Smallest allowed visible span, in milliseconds. */
  readonly minSpanMs?: number;
  /** Largest allowed visible span, in milliseconds. */
  readonly maxSpanMs?: number;
}

/**
 * Items, either given up front or fetched per window.
 *
 * The windowed form is what makes logs and archives tractable: the library
 * asks for the domain it is about to draw and aborts the request when the user
 * keeps zooming.
 */
export type ItemsSource<T = unknown> =
  | readonly Item<T>[]
  | ((domain: Domain, signal: AbortSignal) => Promise<readonly Item<T>[]>);

/** Pointer and gesture tuning. */
export interface InteractionOptions {
  readonly moveTrigger?: MoveTrigger;
  readonly longPressMs?: number;
  /** Movement in pixels before a press becomes a drag. */
  readonly dragThreshold?: number;
  readonly zoom?: boolean;
  readonly pan?: boolean;
}

/** Editing rules. The library validates; it never persists. */
export interface EditingOptions<T = unknown> {
  readonly enabled?: boolean;
  readonly snapMs?: number;
  /** Veto a move or resize before it is applied. */
  readonly canMove?: (item: Item<T>, next: ItemPatch) => boolean;
  readonly multiSelect?: boolean;
  /** Veto an item before it is added. Read by `@temporeum/timeline-core/items`. */
  readonly canAdd?: (item: Item<T>) => boolean;
  /**
   * Veto the removal of an item. One refusal refuses the whole removal: a
   * delete of a selection is atomic.
   */
  readonly canRemove?: (item: Item<T>) => boolean;
}

/** Everything a timeline instance is configured with. */
export interface TimelineOptions<T = unknown> {
  readonly container: Element | string;
  readonly items: ItemsSource<T>;
  readonly lanes?: readonly Lane[];
  readonly domain?: readonly [TimeInput, TimeInput];
  readonly limits?: DomainLimits;
  readonly orientation?: OrientationSetting;
  /** Container width in pixels below which `auto` switches orientation. */
  readonly breakpoint?: number;
  readonly density?: DensitySetting;
  readonly detailSurface?: DetailSurfaceSetting;
  readonly packMode?: PackMode;
  readonly interactions?: InteractionOptions;
  readonly editing?: EditingOptions<T>;
  readonly locale?: string;
  readonly timeZone?: string;
  readonly plugins?: readonly TimelinePlugin<T>[];
}

/**
 * A minimal description of a change to one item.
 *
 * An absent key means "unchanged", which is what lets an inverse restore
 * exactly what its forward patch touched and nothing else. `null` therefore
 * has to be spelled out for every clearable field: without it there is no way
 * to say "this item had no lane", and the inverse of a drag into a lane would
 * be inexact for every item that started outside one.
 */
export interface ItemPatch {
  readonly id: string;
  readonly start?: TimeMs;
  /** `null` clears the end, turning the item into an instant. */
  readonly end?: TimeMs | null;
  /** `null` clears the lane, putting the item back in the default one. */
  readonly laneId?: string | null;
  /**
   * The whole item: present, the item exists with exactly this value; `null`,
   * it does not exist. This is how an add and a remove are patches too — the
   * inverse of an add is a patch with `item: null`. The base entry point's
   * `applyPatches` ignores the key; `applyItemPatches` from
   * `@temporeum/timeline-core/items` applies it.
   */
  readonly item?: Item | null;
  /** Where in the item list an added item goes, so an undone remove puts it back in place. */
  readonly index?: number;
}

/**
 * A reversible description of an edit.
 *
 * Every mutation leaves the library as one of these. The host can apply
 * `after`, store it, and get undo for free from `inverse` — which is why undo
 * is not a feature the host has to reimplement per field.
 */
export interface Command {
  readonly type: string;
  readonly label?: string;
  readonly before: readonly ItemPatch[];
  readonly after: readonly ItemPatch[];
  readonly inverse: Command;
}

/** Why the viewport changed. Lets hosts ignore their own API calls. */
export type ViewportChangeReason = "init" | "pan" | "zoom" | "resize" | "api";

export interface ItemEventPayload<T = unknown> {
  readonly item: Item<T>;
  readonly originalEvent?: PointerEvent;
}

export interface HoverPayload<T = unknown> {
  /** `null` when the pointer left every item. */
  readonly item: Item<T> | null;
  readonly originalEvent?: PointerEvent;
}

export interface SelectionChangedPayload {
  readonly ids: readonly string[];
  readonly previousIds: readonly string[];
}

export interface ViewportChangedPayload {
  readonly viewport: Viewport;
  readonly reason: ViewportChangeReason;
}

export interface LayoutChangedPayload {
  readonly laneCount: number;
  readonly visibleItemCount: number;
  readonly crossSize: number;
}

export interface ItemMovedPayload<T = unknown> {
  readonly item: Item<T>;
  readonly from: ItemPatch;
  readonly to: ItemPatch;
  readonly command: Command;
}

export interface ItemResizedPayload<T = unknown> {
  readonly item: Item<T>;
  readonly from: ItemPatch;
  readonly to: ItemPatch;
  readonly command: Command;
}

export interface CommandPayload {
  readonly command: Command;
}

/** Every event the timeline emits, keyed by name. */
export interface TimelineEventMap<T = unknown> {
  readonly itemClick: ItemEventPayload<T>;
  readonly itemDblClick: ItemEventPayload<T>;
  readonly itemHover: HoverPayload<T>;
  readonly selectionChanged: SelectionChangedPayload;
  readonly viewportChanged: ViewportChangedPayload;
  readonly layoutChanged: LayoutChangedPayload;
  readonly itemMoved: ItemMovedPayload<T>;
  readonly itemResized: ItemResizedPayload<T>;
  readonly command: CommandPayload;
}

export type TimelineEventName = keyof TimelineEventMap & string;

/** What a plugin is handed on every lifecycle call. */
export interface PluginContext<T = unknown> {
  readonly viewport: Viewport;
  readonly items: readonly Item<T>[];
  readonly lanes: readonly Lane[];
  /** Project internal space to screen pixels. */
  readonly project: (point: MainCross) => MainCross;
}

/**
 * The extension boundary.
 *
 * Deliberately narrow: lanes, occupancy, lane rendering, overlays, viewport
 * notifications. A plugin cannot reach into layout internals, which is what
 * keeps the internals free to change without breaking the ecosystem.
 */
export interface TimelinePlugin<T = unknown> {
  readonly name: string;
  readonly provideLanes?: (context: PluginContext<T>) => readonly Lane[];
  readonly provideOccupancy?: (
    context: PluginContext<T>,
  ) => readonly MainCrossRect[];
  readonly renderLane?: (lane: Lane, context: PluginContext<T>) => void;
  readonly renderOverlay?: (context: PluginContext<T>) => void;
  readonly onViewportChanged?: (
    payload: ViewportChangedPayload,
    context: PluginContext<T>,
  ) => void;
  readonly destroy?: () => void;
}
