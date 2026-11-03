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
  TimelineConfig,
  TimelineInstanceEventMap,
  TimelineInstanceEventName,
  TimelineSnapshot,
  TimelineUpdate,
} from "@temporeum/timeline-element";
import { camelize, defineComponent, h, inject, onBeforeUnmount, onMounted, onUpdated, ref, shallowRef, ssrContextKey, Teleport, toValue, useId, watch } from "vue";
import type { MaybeRefOrGetter, PropType, ShallowRef, StyleValue } from "vue";

export type { TimelineConfig, TimelineSnapshot } from "@temporeum/timeline-element";
export type { TimelineInstance };

/** What the component emits: every instance event, by its own name, and `ready` with the instance (`null` on unmount). */
export type TimelineEmits<T = unknown> = { readonly [K in TimelineInstanceEventName]: (payload: TimelineInstanceEventMap<T>[K]) => void } & {
  readonly ready: (timeline: TimelineInstance<T> | null) => void;
};

/** The component's own attributes — the rest are {@link TimelineConfig} fields. */
const OWN = new Set(["class", "style", "ssrWidth"]);

/** `useId` gives `v-0` or `v:0`; a stylesheet scope wants a plain name. */
const scopeOf = (id: string): string => `tl${id.replace(/[^a-zA-Z0-9_-]/g, "")}`;

/** The configuration part of the attributes: every key in camelCase, the component's own left out. */
function configOf(attrs: Record<string, unknown>, scope: string): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  for (const key of Object.keys(attrs)) {
    const name = camelize(key);
    if (!OWN.has(name)) config[name] = attrs[key];
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
    if (before[key] !== next[key]) {
      changed[key] = next[key];
      any = true;
    }
  }
  return any ? changed : undefined;
}

/**
 * The timeline. Every {@link TimelineConfig} field is an attribute
 * (`:items`, `:selected-ids` or `:selectedIds`), every instance event an
 * emit (`@item-moved`, `@selection-changed`, …), and `ready` hands over the
 * live instance; a template ref's `timeline` is the same instance.
 *
 * The `#item` slot (`<template #item="{ item }">`) is each item's content
 * as Vue, teleported into the box over the item (`slots`): only the items
 * drawn have one. The content is a picture — the pointer and the keyboard
 * act on the item, and its `label` stays its accessible name. Needs the
 * `/items` plugin, as `template` does.
 */
export const Timeline = defineComponent({
  name: "TemporeumTimeline",
  inheritAttrs: false,
  props: {
    /** Width the server draws at; the client redraws at the real one. */
    ssrWidth: { type: Number as PropType<number>, default: undefined },
  },
  emits: [...TIMELINE_EVENTS, "ready"] as unknown as TimelineEmits,
  setup(props, { attrs, emit, expose, slots }) {
    const scope = scopeOf(useId());
    const container = ref<HTMLDivElement | null>(null);
    const timeline = shallowRef<TimelineInstance | null>(null);
    const drawn = shallowRef<ReadonlyMap<string, ItemSlot>>(new Map());
    // With an `#item` slot every item has a box, unless `slots` picks.
    const configNow = (): Record<string, unknown> => {
      const config = configOf(attrs, scope);
      if (slots.item !== undefined && config.slots === undefined) config.slots = true;
      return config;
    };
    let applied = configNow();
    // The server's drawing, computed once — on the server only: Vue's
    // server renderer is what provides an SSR context.
    const html =
      inject(ssrContextKey, null) !== null
        ? (() => {
            const frame = renderTimelineSvg(applied as TimelineConfig, props.ssrWidth === undefined ? {} : { width: props.ssrWidth });
            return frame.svg + frame.groups;
          })()
        : undefined;
    let stops: (() => void)[] = [];

    onMounted(() => {
      const instance = createTimeline(container.value as HTMLDivElement, applied as TimelineConfig, { hydrate: true });
      const send = emit as (type: string, payload: unknown) => void;
      stops = TIMELINE_EVENTS.map((type) => instance.on(type, (payload) => send(type, payload)));
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
      if (changed !== undefined) timeline.value?.update(changed as TimelineUpdate);
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
      const height = (attrs.height as number | undefined) ?? DEFAULT_HEIGHT;
      const item = slots.item;
      const teleports = item === undefined ? [] : [...drawn.value].map(([id, slot]) => h(Teleport, { key: id, to: slot.element }, item({ item: slot.item })));
      // The teleports are the box's children, as anchors: one root, so the
      // server's markup stays the box alone. Without a teleport the box has
      // no children for Vue — on the server it has the drawing, and while
      // hydrating Vue must not compare the instance's nodes with any.
      return h(
        "div",
        {
        ref: container,
        // Only a class the host gave: Vue prints an empty one as `class=""`.
        ...(attrs.class === undefined ? {} : { class: attrs.class }),
        style: [{ position: "relative", overflow: "hidden", height: `${String(height)}px` }, attrs.style as StyleValue],
        "data-tl-vue": "",
        ...(html === undefined ? {} : { innerHTML: html }),
        },
        html === undefined && teleports.length > 0 ? teleports : undefined,
      );
    };
  },
});

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
