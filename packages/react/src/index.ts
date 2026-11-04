/**
 * `@temporeum/timeline-react` — the timeline as a React component.
 *
 * The component is a shell around the shared instance
 * (`createTimeline`, from `@temporeum/timeline-element`): it creates the
 * instance once, hands it every changed prop, and lets go of it on unmount.
 * It does not re-render to draw. A pan of a hundred pointer events is drawn
 * by the instance, imperatively, and React does not hear of it — which is
 * the whole point of the adapter: React's reconciliation is the wrong tool
 * for sixty frames a second of SVG attributes.
 *
 * What React *does* render from is the instance's store. `useTimelineState`
 * subscribes to it with `useSyncExternalStore` and a selector: a component
 * that shows the selection re-renders when the selection changes and at no
 * other time; one that shows the visible range re-renders once per drawn
 * frame at most, however many events the frame held.
 *
 * **Server rendering.** On the server the component prints the same drawing
 * the browser would draw (the core is DOM-free), so the page shows a
 * timeline before the bundle loads. On hydration the instance takes those
 * nodes over instead of drawing a second timeline.
 */

import { renderTimelineSvg, createTimeline, DEFAULT_HEIGHT, TIMELINE_EVENTS } from "@temporeum/timeline-element";
import type {
  ItemSlot,
  Timeline as TimelineInstance,
  TimelineComponentConfig,
  TimelineConfig,
  TimelineInstanceEventMap,
  TimelineInstanceEventName,
  TimelineSnapshot,
  TimelineUpdate,
} from "@temporeum/timeline-element";
import { createElement, Fragment, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { CSSProperties, ReactElement, ReactNode, Ref } from "react";
import { createPortal, flushSync } from "react-dom";

export type { TimelineComponentConfig, TimelineConfig, TimelineSnapshot } from "@temporeum/timeline-element";
/** The element's plugin registry, from the adapter too: an app that installs only the adapter still registers the plugins its configuration needs. */
export { hasPlugin, registerPlugin } from "@temporeum/timeline-element";
export type { PluginName, TimelinePlugin } from "@temporeum/timeline-element";
export type { TimelineInstance };

/** `itemMoved` → `onItemMoved`. */
type HandlerName<K extends string> = `on${Capitalize<K>}`;

/** One callback prop per instance event. */
export type TimelineHandlers<T = unknown> = {
  readonly [K in TimelineInstanceEventName as HandlerName<K>]?: (payload: TimelineInstanceEventMap<T>[K]) => void;
};

/**
 * The `<Timeline>` component's props: every `TimelineConfig` field, an `on…`
 * handler for every instance event, and the few that are React's own. The
 * view and the selection are where the timeline starts (`defaultDomain`,
 * `defaultSelectedIds`): a re-render does not move them; the instance's
 * `zoomTo` and `select` do.
 */
export interface TimelineProps<T = unknown> extends TimelineComponentConfig<T>, TimelineHandlers<T> {
  readonly className?: string;
  readonly style?: CSSProperties;
  /** The box's `id`; `data-*`, `aria-*`, `role` and `title` go on the box too. */
  readonly id?: string;
  readonly role?: string;
  readonly title?: string;
  readonly [attribute: `data-${string}`]: string | number | boolean | undefined;
  readonly [attribute: `aria-${string}`]: string | number | boolean | undefined;
  /** The box, on React 19, where a function component takes `ref` as a prop. */
  readonly ref?: Ref<HTMLDivElement>;
  /** Width the server draws at; the client redraws at the real one. */
  readonly ssrWidth?: number;
  /**
   * Receives the live instance after mount, and `null` on unmount. A state
   * setter works: `timelineRef={setTimeline}` then
   * `useTimelineState(timeline, …)`.
   */
  readonly timelineRef?: Ref<TimelineInstance<T> | null>;
  /**
   * Each item's content as React: rendered into the box over the item
   * (`slots`), by a portal, so it keeps its state and context while the
   * item is in view. Only the items drawn have one — a timeline of ten
   * thousand renders the few hundred on screen. The content is a picture:
   * the pointer and the keyboard act on the item, and the item's `label`
   * stays its accessible name. Needs the `/items` plugin, as `template` does.
   */
  readonly renderItem?: (item: Item<T>) => ReactNode;
}

/** An item, as the element's types name it (the adapter depends on the element alone). */
type Item<T> = ItemSlot<T>["item"];

const EVENTS = TIMELINE_EVENTS;

const handlerOf = (type: TimelineInstanceEventName): string => `on${type[0]?.toUpperCase() ?? ""}${type.slice(1)}`;
const HANDLERS = new Set(EVENTS.map(handlerOf));
const OWN = new Set(["className", "style", "ssrWidth", "timelineRef", "renderItem", "defaultDomain", "defaultSelectedIds", "domain", "selectedIds", "ref", "key", "children"]);

/**
 * The configuration's fields: these props go to the instance; any other —
 * `id`, `data-*`, `aria-*`, `role` — goes on the box, as a `div`'s would.
 * Typed against the configuration, so a field added there and not here
 * fails to compile.
 */
const CONFIG: { readonly [K in keyof TimelineComponentConfig]-?: true } = {
  items: true,
  lanes: true,
  groups: true,
  template: true,
  templateOptions: true,
  slots: true,
  gantt: true,
  resources: true,
  resourceOptions: true,
  defaultDomain: true,
  limits: true,
  orientation: true,
  breakpoint: true,
  density: true,
  metrics: true,
  packMode: true,
  theme: true,
  locale: true,
  timeZone: true,
  formatTick: true,
  axisContext: true,
  touchAction: true,
  maxLabels: true,
  labelOverflow: true,
  ariaLabel: true,
  decorations: true,
  cluster: true,
  hooks: true,
  height: true,
  interactions: true,
  editing: true,
  defaultSelectedIds: true,
  instanceId: true,
  nonce: true,
  measureText: true,
  sceneSpace: true,
  hiddenDates: true,
  timeBars: true,
  timeBarOptions: true,
  rolling: true,
  zoomPresets: true,
  minimap: true,
  rangeSelect: true,
  laneHeaders: true,
  tooltip: true,
  direction: true,
  strings: true,
  calendar: true,
};
const NO_SLOTS: ReadonlyMap<string, ItemSlot> = new Map();

// The layout effect is what creates the instance before the browser paints;
// on the server neither effect runs, and React 18 warns about the layout one.
const useIsomorphicLayoutEffect = typeof document === "undefined" ? useEffect : useLayoutEffect;

const subscribeNothing = (): (() => void) => () => {};

function assign<V>(ref: Ref<V> | undefined, value: V): void {
  if (typeof ref === "function") ref(value);
  else if (ref !== null && ref !== undefined) (ref as { current: V }).current = value;
}

/** The configuration part of the props: the configuration's fields, but where the view and the selection start. */
function configOf<T>(props: TimelineProps<T>): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  for (const key of Object.keys(props)) {
    if (Object.hasOwn(CONFIG, key) && !OWN.has(key)) config[key] = (props as Record<string, unknown>)[key];
  }
  return config;
}

/** The props that are the box's: neither a configuration field, nor a handler, nor the component's own. */
function boxOf<T>(props: TimelineProps<T>): Record<string, unknown> {
  const box: Record<string, unknown> = {};
  for (const key of Object.keys(props)) {
    // An own `__proto__` is not a prop: assigned, it would set the box's prototype.
    if (key !== "__proto__" && !Object.hasOwn(CONFIG, key) && !HANDLERS.has(key) && !OWN.has(key)) box[key] = (props as Record<string, unknown>)[key];
  }
  return box;
}

/** The configuration the instance starts from: the props', with the view and the selection they start at. */
function initialOf<T>(config: TimelineConfig<T>, props: TimelineProps<T>): TimelineConfig<T> {
  return {
    ...config,
    ...(props.defaultDomain === undefined ? {} : { domain: props.defaultDomain }),
    ...(props.defaultSelectedIds === undefined ? {} : { selectedIds: props.defaultSelectedIds }),
  };
}

/** `useId` gives `:r0:` or `«r0»`; a stylesheet scope wants a plain name. */
const scopeOf = (id: string): string => `tl${id.replace(/[^a-zA-Z0-9_-]/g, "")}`;

/** The timeline. Every {@link TimelineConfig} field is a prop, every event an `on…` prop. */
export function Timeline<T = unknown>(props: TimelineProps<T>): ReactElement {
  const generated = scopeOf(useId());
  const config = configOf(props) as TimelineConfig<T>;
  if (config.instanceId === undefined) {
    // Light DOM: two timelines on one page must not share one stylesheet.
    (config as { instanceId?: string }).instanceId = generated;
  }
  if (props.renderItem !== undefined && config.slots === undefined) (config as { slots?: boolean }).slots = true;
  // True on the server and while hydrating, false for a client-only render:
  // the one moment the server's markup is what React compares against.
  const hydrating = useSyncExternalStore(
    subscribeNothing,
    () => false,
    () => true,
  );
  // Computed once. The string never changes afterwards, so React never
  // writes the container's innerHTML again — the instance owns what is in it.
  // The drawing and, with groups, the header tree after it: the client takes both over.
  const [initial] = useState(() => initialOf(config, props));
  const [html] = useState(() => {
    if (!hydrating) return "";
    const frame = renderTimelineSvg(initial, props.ssrWidth === undefined ? {} : { width: props.ssrWidth });
    return frame.svg + frame.groups;
  });
  const container = useRef<HTMLDivElement>(null);
  const instance = useRef<TimelineInstance<T> | null>(null);
  const latest = useRef(props);
  const applied = useRef<Record<string, unknown>>(config as Record<string, unknown>);
  // After the render commits, not during it: a render React throws away
  // (a transition, a suspended tree) must not leave its callbacks behind.
  useIsomorphicLayoutEffect(() => {
    latest.current = props;
  });
  const [slots, setSlots] = useState<ReadonlyMap<string, ItemSlot<T>>>(NO_SLOTS as ReadonlyMap<string, ItemSlot<T>>);
  // Inside the effects a state update is rendered before the paint anyway,
  // and `flushSync` there is an error React only warns about.
  const inEffect = useRef(false);

  useIsomorphicLayoutEffect(() => {
    const element = container.current as HTMLDivElement;
    inEffect.current = true;
    const timeline = createTimeline<T>(element, { ...initial, ...applied.current } as TimelineConfig<T>, { hydrate: true });
    instance.current = timeline;
    // A box handed to another item has to show that item in the frame that
    // handed it over, not one later: the frame is drawn outside React, so
    // the portals are rendered at once.
    const stopSlots = timeline.on("slotsChanged", ({ slots: next }) => {
      if (inEffect.current) setSlots(next);
      else flushSync(() => setSlots(next));
    });
    setSlots(timeline.slots);
    inEffect.current = false;
    // Through the ref of the latest props: a new callback each render does
    // not resubscribe, and the one that runs is always the current one.
    const stops = EVENTS.map((type) =>
      timeline.on(type, (payload) => {
        const handler = (latest.current as Record<string, unknown>)[handlerOf(type)];
        if (typeof handler === "function") (handler as (value: unknown) => void)(payload);
      }),
    );
    return () => {
      stopSlots();
      for (const stop of stops) stop();
      timeline.destroy();
      instance.current = null;
    };
  }, []);

  // The ref the props hold now gets the instance; one taken away gets `null`.
  const timelineRef = props.timelineRef;
  useIsomorphicLayoutEffect(() => {
    const timeline = instance.current;
    if (timeline === null) return undefined;
    assign(timelineRef, timeline);
    return () => assign(timelineRef, null);
  }, [timelineRef]);

  // React 19 hands `ref` to a function component as a prop: it is the box's.
  const outer = (props as { ref?: Ref<HTMLDivElement> }).ref;
  const boxRef = useCallback(
    (node: HTMLDivElement | null) => {
      container.current = node;
      assign(outer, node);
    },
    [outer],
  );

  // Hand the instance what changed, and only that: an unchanged `items`
  // array must not look like new data.
  useIsomorphicLayoutEffect(() => {
    const timeline = instance.current;
    const before = applied.current;
    const next = config as Record<string, unknown>;
    const changed: Record<string, unknown> = {};
    let any = false;
    for (const key of new Set([...Object.keys(before), ...Object.keys(next)])) {
      if (key !== "__proto__" && before[key] !== next[key]) {
        changed[key] = next[key];
        any = true;
      }
    }
    applied.current = next;
    inEffect.current = true;
    if (any && timeline !== null) timeline.update(changed as TimelineUpdate<T>);
    inEffect.current = false;
  });

  const renderItem = props.renderItem;
  const portals = renderItem === undefined ? [] : [...slots].map(([id, slot]) => createPortal(renderItem(slot.item), slot.element, id));

  const box = createElement("div", {
    ...boxOf(props),
    ref: boxRef,
    className: props.className,
    style: { position: "relative", overflow: "hidden", height: config.height ?? DEFAULT_HEIGHT, ...props.style },
    "data-tl-react": "",
    // The server's drawing. Identical on the hydrating client, so React has
    // nothing to compare; none on a client-only render, which writes no HTML
    // at all — the instance draws with the DOM, which a Trusted Types policy
    // has no say over.
    ...(html === "" ? {} : { dangerouslySetInnerHTML: { __html: html } }),
    suppressHydrationWarning: true,
  });
  // Always the fragment: a root that turned from the box into a fragment
  // when the first portal came would be a new box, and the drawing lost.
  return createElement(Fragment, null, box, ...portals);
}

/**
 * Subscribe to the part of the instance's state a component renders.
 *
 * Re-renders when `selector`'s result changes (by `isEqual`, `Object.is`
 * by default) — and at most once per drawn frame, because the store
 * notifies at most once per frame. `undefined` until there is an instance.
 */
export function useTimelineState<T, S>(
  timeline: TimelineInstance<T> | null | undefined,
  selector: (snapshot: TimelineSnapshot) => S,
  isEqual: (a: S, b: S) => boolean = Object.is,
): S | undefined {
  const memo = useRef<{ snapshot: TimelineSnapshot; selector: (snapshot: TimelineSnapshot) => S; selected: S } | undefined>(undefined);
  const subscribe = useCallback((listener: () => void) => timeline?.subscribe(listener) ?? (() => {}), [timeline]);
  const read = (): S | undefined => {
    if (timeline === null || timeline === undefined) return undefined;
    const snapshot = timeline.getSnapshot();
    const cached = memo.current;
    // The same snapshot and the same selector: the same answer. A new
    // selector (a closure over new state) reads the snapshot again.
    if (cached !== undefined && cached.snapshot === snapshot && cached.selector === selector) return cached.selected;
    const selected = selector(snapshot);
    if (cached !== undefined && isEqual(cached.selected, selected)) {
      memo.current = { snapshot, selector, selected: cached.selected };
      return cached.selected;
    }
    memo.current = { snapshot, selector, selected };
    return selected;
  };
  return useSyncExternalStore(subscribe, read, () => undefined);
}
