/**
 * `@temporeum/timeline-vue` — the timeline as a Vue component.
 *
 * The component is a shell around the shared instance (`createTimeline`,
 * from `@temporeum/timeline-element`), as the React one is: it creates the
 * instance once, on mount, hands it every attribute that changed, and lets
 * go of it on unmount. It does not re-render to draw. A pan of a hundred
 * pointer events is drawn by the instance, imperatively, and Vue does not
 * hear of it — its reactivity is the wrong tool for sixty frames a second of
 * SVG attributes.
 *
 * What a component *does* render from is the instance's store.
 * `useTimelineState` subscribes to it with a selector and gives a shallow
 * ref: one that shows the selection changes when the selection changes and
 * at no other time; one that shows the visible range changes once per drawn
 * frame at most, however many events the frame held.
 *
 * **Server rendering.** On the server the component prints the same drawing
 * the browser would draw (the core is DOM-free), so the page shows a
 * timeline before the bundle loads; on hydration the instance takes those
 * nodes over. The drawing goes into the server's markup only: Vue 3.5
 * writes a dynamic `innerHTML` again while hydrating, and an `innerHTML`
 * written by script is not the parser's — the instance would draw a second
 * timeline. On the client the node has no children for Vue to compare, so
 * Vue leaves alone what the parser built.
 */

import { createTimeline, DEFAULT_HEIGHT, renderTimelineSvg, TIMELINE_EVENTS } from "@temporeum/timeline-element";
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
import { defineComponent, h, inject, onBeforeUnmount, onMounted, onUpdated, ref, shallowRef, ssrContextKey, Teleport, toRaw, toValue, useId, watch } from "vue";
import type {
  AllowedComponentProps,
  ComponentCustomProps,
  ComponentOptionsMixin,
  CreateComponentPublicInstanceWithMixins,
  MaybeRefOrGetter,
  PublicProps,
  SetupContext,
  ShallowRef,
  SlotsType,
  VNodeProps,
} from "vue";

export type { TimelineComponentConfig, TimelineConfig, TimelineSnapshot } from "@temporeum/timeline-element";
/** The element's plugin registry, from the adapter too: an app that installs only the adapter still registers the plugins its configuration needs. */
// The data and the event payloads, handed on: one install types an app.
export type {
  ClusterOpenedPayload,
  CommandPayload,
  DensityChangedPayload,
  Domain,
  Group,
  GroupMovedPayload,
  GroupToggledPayload,
  HoverPayload,
  InputSkippedPayload,
  Item,
  ItemEventPayload,
  ItemMovedPayload,
  ItemResizedPayload,
  ItemsAddedPayload,
  ItemsChangedPayload,
  ItemsRemovedPayload,
  JumpRequestPayload,
  Lane,
  LayoutChangedPayload,
  OrientationChangedPayload,
  SelectionChangedPayload,
  SlotsChangedPayload,
  TimeBar,
  TimeBarMovedPayload,
  TimelineInstanceEventMap,
  TimelineInstanceEventName,
  TimeMs,
  TimeRange,
  ViewportChangedPayload,
} from "@temporeum/timeline-element";
export { hasPlugin, registerPlugin } from "@temporeum/timeline-element";
export type { PluginName, TimelinePlugin } from "@temporeum/timeline-element";
export type { TimelineInstance };

/** What the component emits: every instance event, by its own name, and `ready` with the instance (`null` on unmount). */
export type TimelineEmits<T = unknown> = { readonly [K in TimelineInstanceEventName]: (payload: TimelineInstanceEventMap<T>[K]) => void } & {
  readonly ready: (timeline: TimelineInstance<T> | null) => void;
};

/** The component's props: every {@link TimelineComponentConfig} field, and the width the server draws at. */
export type TimelineProps<T = unknown> = TimelineComponentConfig<T> & {
  /** Width the server draws at; the client redraws at the real one. */
  readonly ssrWidth?: number | undefined;
};

/** The `#item` slot: each drawn item's content. */
export type TimelineSlots<T = unknown> = SlotsType<{ readonly item: { readonly item: Item<T> } }>;

/** A handler prop for every event — `onItemMoved`, `onReady`, … — its payload typed by the items' data. */
export type TimelineListeners<T = unknown> = { readonly [K in keyof TimelineEmits<T> & string as `on${Capitalize<K>}`]?: TimelineEmits<T>[K] };

/**
 * The component's type, generic over the items' data: every prop, every
 * handler and the `#item` slot typed by it, and a template ref's `timeline`.
 * Written out because Vue types the runtime `emits` list — the names — as
 * handlers of `(...args: any[]) => any`, and the options' slots as `unknown`.
 */
export type TimelineComponent = new <T = unknown>(
  props: TimelineProps<T> & TimelineListeners<T> & VNodeProps & AllowedComponentProps & ComponentCustomProps,
) => CreateComponentPublicInstanceWithMixins<
  TimelineProps<T> & TimelineListeners<T>,
  { readonly timeline: TimelineInstance<T> | null },
  Record<never, never>,
  Record<never, never>,
  Record<never, never>,
  ComponentOptionsMixin,
  ComponentOptionsMixin,
  TimelineEmits<T>,
  PublicProps,
  Record<never, never>,
  false,
  Record<never, never>,
  TimelineSlots<T>
>;

/** An item, as the element's types name it (the adapter depends on the element alone). */
type Item<T> = ItemSlot<T>["item"];

/**
 * A prop that may be written as a bare attribute (`<Timeline lane-headers />`)
 * is a boolean first: Vue reads the empty string as `true` for it. The rest
 * take any value, and an absent one is `undefined` — not in the
 * configuration, so the instance's default holds.
 */
const ANY = { type: null, default: undefined } as const;
const FLAG = { type: Boolean, default: undefined } as const;
const PROPS: { readonly [K in keyof TimelineProps]-?: { readonly type: unknown; readonly default: undefined } } = {
  items: ANY,
  lanes: ANY,
  groups: ANY,
  template: ANY,
  templateOptions: ANY,
  slots: { type: [Boolean, Function], default: undefined },
  gantt: ANY,
  resources: ANY,
  resourceOptions: ANY,
  defaultDomain: ANY,
  limits: ANY,
  orientation: ANY,
  breakpoint: ANY,
  density: ANY,
  metrics: ANY,
  packMode: ANY,
  theme: ANY,
  locale: ANY,
  timeZone: ANY,
  formatTick: ANY,
  axisContext: FLAG,
  touchAction: ANY,
  maxLabels: ANY,
  labelOverflow: ANY,
  ariaLabel: ANY,
  decorations: ANY,
  cluster: { type: [Boolean, Object], default: undefined },
  hooks: ANY,
  height: ANY,
  interactions: ANY,
  editing: ANY,
  defaultSelectedIds: ANY,
  instanceId: ANY,
  nonce: ANY,
  measureText: ANY,
  sceneSpace: { type: [Boolean, String], default: undefined },
  hiddenDates: ANY,
  timeBars: ANY,
  timeBarOptions: ANY,
  rolling: { type: [Boolean, Object], default: undefined },
  zoomPresets: { type: [Boolean, Array], default: undefined },
  minimap: { type: [Boolean, Object], default: undefined },
  rangeSelect: { type: [Boolean, Object], default: undefined },
  laneHeaders: FLAG,
  tooltip: { type: [Boolean, Function], default: undefined },
  direction: ANY,
  strings: ANY,
  calendar: ANY,
  ssrWidth: { type: Number, default: undefined },
};

/** Where the view and the selection start, and the server's width: said once, not configuration that changes. */
const OWN = new Set(["ssrWidth", "defaultDomain", "defaultSelectedIds"]);

/** `useId` gives `v-0` or `v:0`; a stylesheet scope wants a plain name. */
const scopeOf = (id: string): string => `tl${id.replace(/[^a-zA-Z0-9_-]/g, "")}`;

/**
 * The configuration part of the props: the ones given, as plain values. A
 * reactive array or object the host passes is Vue's proxy of it; the
 * instance holds the object itself, so its identity is the host's and the
 * frames do not go through the proxy.
 */
function configOf(props: Record<string, unknown>, scope: string): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  for (const key of Object.keys(PROPS)) {
    const value = props[key];
    if (!OWN.has(key) && value !== undefined) config[key] = toRaw(value);
  }
  // Light DOM: two timelines on one page must not share one stylesheet.
  if (config.instanceId === undefined) config.instanceId = scope;
  return config;
}

/** The keys whose values are not the same object: an unchanged `items` array must not look like new data. */
function changedOf(before: Record<string, unknown>, next: Record<string, unknown>): Record<string, unknown> | undefined {
  const changed: Record<string, unknown> = {};
  let any = false;
  for (const key of new Set([...Object.keys(before), ...Object.keys(next)])) {
    if (key !== "__proto__" && before[key] !== next[key]) {
      changed[key] = next[key];
      any = true;
    }
  }
  return any ? changed : undefined;
}

/**
 * The timeline. Every {@link TimelineConfig} field is a prop (`:items`,
 * `:time-zone` or `:timeZone`, a bare `lane-headers`), every instance event
 * an emit (`@item-moved`, `@selection-changed`, …), and `ready` hands over
 * the live instance; a template ref's `timeline` is the same instance.
 * `class`, `style`, `id` and the rest of the attributes go on the box.
 *
 * The `#item` slot (`<template #item="{ item }">`) is each item's content
 * as Vue, teleported into the box over the item (`slots`): only the items
 * drawn have one. The content is a picture — the pointer and the keyboard
 * act on the item, and its `label` stays its accessible name. Needs the
 * `/items` plugin, as `template` does.
 */
export const Timeline: TimelineComponent = defineComponent(
  <T = unknown>(props: TimelineProps<T>, { emit, expose, slots }: SetupContext<TimelineEmits<T>, TimelineSlots>) => {
    // Vue 3.5.0 types useId() as possibly undefined (outside a setup); here it is in one.
    const scope = scopeOf(useId() ?? "");
    const container = ref<HTMLDivElement | null>(null);
    const timeline = shallowRef<TimelineInstance<T> | null>(null);
    const drawn = shallowRef<ReadonlyMap<string, ItemSlot<T>>>(new Map());
    // With an `#item` slot every item has a box, unless `slots` picks.
    const configNow = (): Record<string, unknown> => {
      const config = configOf(props as Record<string, unknown>, scope);
      if (slots.item !== undefined && config.slots === undefined) config.slots = true;
      return config;
    };
    let applied = configNow();
    const initial: Record<string, unknown> = {
      ...applied,
      ...(props.defaultDomain === undefined ? {} : { domain: toRaw(props.defaultDomain) }),
      ...(props.defaultSelectedIds === undefined ? {} : { selectedIds: toRaw(props.defaultSelectedIds) }),
    };
    // The server's drawing, computed once — on the server only: Vue's
    // server renderer is what provides an SSR context.
    const html =
      inject(ssrContextKey, null) !== null
        ? (() => {
            const frame = renderTimelineSvg(initial as TimelineConfig<T>, props.ssrWidth === undefined ? {} : { width: props.ssrWidth });
            return frame.svg + frame.groups;
          })()
        : undefined;
    let stops: (() => void)[] = [];

    onMounted(() => {
      const instance = createTimeline<T>(container.value as HTMLDivElement, { ...initial, ...applied } as TimelineConfig<T>, { hydrate: true });
      stops = TIMELINE_EVENTS.map((type) => instance.on(type, (payload) => forward(emit, type, payload)));
      // Vue renders the teleports in its own flush, a microtask after the
      // frame that drew the boxes: before the browser paints it.
      stops.push(instance.on("slotsChanged", ({ slots: next }) => (drawn.value = next)));
      drawn.value = instance.slots;
      timeline.value = instance;
      emit("ready", instance);
    });

    // Hand the instance what changed, and only that.
    onUpdated(() => {
      const next = configNow();
      const changed = changedOf(applied, next);
      applied = next;
      if (changed !== undefined) timeline.value?.update(changed as TimelineUpdate<T>);
    });

    onBeforeUnmount(() => {
      for (const stop of stops) stop();
      stops = [];
      timeline.value?.destroy();
      timeline.value = null;
      emit("ready", null);
    });

    expose({ timeline });

    return () => {
      const height = props.height ?? DEFAULT_HEIGHT;
      const item = slots.item;
      const teleports = item === undefined ? [] : [...drawn.value].map(([id, slot]) => h(Teleport, { key: id, to: slot.element }, item({ item: slot.item })));
      // The teleports are the box's children, as anchors: one root, so the
      // server's markup stays the box alone. Without a teleport the box has
      // no children for Vue — on the server it has the drawing, and while
      // hydrating Vue must not compare the instance's nodes with any. The
      // host's class, style and attributes fall through onto the box.
      return h(
        "div",
        {
          ref: container,
          style: { position: "relative", overflow: "hidden", height: `${String(height)}px` },
          "data-tl-vue": "",
          ...(html === undefined ? {} : { innerHTML: html }),
        },
        html === undefined && teleports.length > 0 ? teleports : undefined,
      );
    };
  },
  {
    name: "TemporeumTimeline",
    // The runtime declaration; the types are the setup function's, generic over the items' data.
    props: PROPS as never,
    emits: [...TIMELINE_EVENTS, "ready"],
    slots: Object as TimelineSlots,
  },
) as unknown as TimelineComponent;

/** One instance event, emitted under its own name: the payload is that event's. */
function forward<T, K extends TimelineInstanceEventName>(emit: SetupContext<TimelineEmits<T>>["emit"], type: K, payload: TimelineInstanceEventMap<T>[K]): void {
  (emit as (type: K, payload: TimelineInstanceEventMap<T>[K]) => void)(type, payload);
}

/**
 * Subscribe to the part of the instance's state a component renders.
 *
 * The ref changes when `selector`'s result changes (by `isEqual`,
 * `Object.is` by default) — and at most once per drawn frame, because the
 * store notifies at most once per frame. `undefined` until there is an
 * instance; `timeline` may be a ref, a getter (`() => view.value?.timeline`)
 * or the instance itself.
 */
export function useTimelineState<T, S>(
  timeline: MaybeRefOrGetter<TimelineInstance<T> | null | undefined>,
  selector: (snapshot: TimelineSnapshot) => S,
  isEqual: (a: S, b: S) => boolean = Object.is,
): Readonly<ShallowRef<S | undefined>> {
  const state = shallowRef<S | undefined>(undefined);
  watch(
    () => toValue(timeline),
    (instance, _, onCleanup) => {
      if (instance === null || instance === undefined) {
        state.value = undefined;
        return;
      }
      let seen: { snapshot: TimelineSnapshot; selected: S } | undefined;
      const read = (): void => {
        const snapshot = instance.getSnapshot();
        if (seen !== undefined && seen.snapshot === snapshot) return;
        const selected = selector(snapshot);
        if (seen !== undefined && isEqual(seen.selected, selected)) {
          seen = { snapshot, selected: seen.selected };
          return;
        }
        seen = { snapshot, selected };
        state.value = selected;
      };
      read();
      onCleanup(instance.subscribe(read));
    },
    { immediate: true },
  );
  return state;
}
