# @temporeum/timeline-vue

The timeline as a Vue component, built on the shared instance of
[`@temporeum/timeline-element`](https://github.com/horakdani/Temporeum_timeline_SDK/tree/main/packages/web-component#readme).

```bash
npm install @temporeum/timeline-vue @temporeum/timeline-element
```

The element is the adapter's own dependency; list it beside the adapter, as
above, to import its plugins (`@temporeum/timeline-element/items`, `/gantt`,
`/resources` …): pnpm and Yarn PnP let an app import only what it lists. The
types an app writes — `Item`, `Lane`, `Group`, `TimeMs` and every event's
payload (`ItemMovedPayload`, `SelectionChangedPayload` …) — come from
`@temporeum/timeline-vue` itself.

The peer range is `vue ^3.5.0` (`useId` is new in 3.5). The suite runs on
the newest Vue 3 and, in CI, on 3.5.0, the lowest the range admits.

```vue excerpt:template/vue/src/App.vue
<script setup>
import { Timeline, useTimelineState } from "@temporeum/timeline-vue";
import { ref, shallowRef } from "vue";

const DAY = 86_400_000;
const t = Date.UTC(2026, 2, 2);
const items = [
  { id: "design", label: "Design", laneId: "work", start: t, end: t + 7 * DAY, data: { owner: "Ana" } },
  { id: "launch", label: "Launch", laneId: "ship", start: t + 25 * DAY, end: t + 32 * DAY, data: { owner: "Dev" } },
];
const lanes = [
  { id: "work", label: "Work" },
  { id: "ship", label: "Shipping" },
];

const timeline = shallowRef(null);
const selected = useTimelineState(timeline, (state) => state.selectedIds);
const log = ref("Drag an item.");
const onMoved = ({ item, to }) => {
  log.value = `${item.label} moved to ${new Date(to.start ?? item.start).toDateString()}`;
};
</script>

<template>
  <main style="padding: 16px">
    <Timeline
      :items="items"
      :lanes="lanes"
      :height="320"
      aria-label="Release plan"
      :editing="{ enabled: true, snapMs: DAY }"
      @item-moved="onMoved"
      @ready="timeline = $event"
    >
      <!-- An item's content as Vue: a picture of the item, its label still its name. -->
      <template #item="{ item }">
        <b>{{ item.label }}</b> · {{ item.data.owner }}
      </template>
    </Timeline>
    <p aria-live="polite">{{ log }} {{ selected?.length ?? 0 }} selected.</p>
  </main>
</template>
```

The whole project, with Vite, is the [Vue template](https://github.com/horakdani/Temporeum_timeline_SDK/tree/main/packages/docs/templates/vue); a
[Nuxt one](https://github.com/horakdani/Temporeum_timeline_SDK/tree/main/packages/docs/templates/nuxt) is beside it.

Every [`TimelineConfig`](https://horakdani.github.io/Temporeum_timeline_SDK/reference/api.html#configuration) field is a typed
prop — in camelCase or kebab-case, `:time-zone` is `timeZone`, and a bare
`lane-headers` is `true`; `class`, `style`, `id` and other attributes go on
the box —
and every instance event an emit by its own name (`@item-moved`,
`@selection-changed`, `@viewport-changed`, …). `@ready` hands over the live
instance, and `null` on unmount; a template ref's `timeline` is the same
instance.

The view and the selection are where the timeline starts:
`:default-domain` and `:default-selected-ids`. A re-render does not move
them back; the instance's `zoomTo` and `select` do. Every other attribute
is compared by what it says, so an `:editing="{ enabled: true }"` object
written anew on each render is no change.

## It does not re-render to draw

The component creates the instance once, on mount, and hands it the
attributes that changed — the same `items` array is not new data. A pan, a
pinch, a drag are drawn by the instance, imperatively; Vue does not hear of
them. What a component renders from is the instance's store:
`useTimelineState(timeline, selector, isEqual?)` gives a shallow ref that
changes when the selected part does, and at most once per drawn frame,
however many pointer events the frame held. `timeline` may be a ref, a
getter (`() => view.value?.timeline`) or the instance.

## Server rendering

On the server — Nuxt, or `renderToString` of your own — the component prints
the drawing the browser would draw, at `ssr-width` (960 px by default), and
on hydration the instance takes those nodes over instead of drawing again.
Nothing else is needed: no client plugin, no compiler option.

```vue excerpt:template/nuxt/app/app.vue
<template>
  <main>
    <Timeline :items="items" :lanes="lanes" :height="320" aria-label="Release plan" :ssr-width="960" />
  </main>
</template>
```

The drawing goes into the server's markup only. Vue 3.5 writes a dynamic
`innerHTML` again while hydrating, and an `innerHTML` written by script is a
second drawing, not the parser's first; on the client the component's node
has no children for Vue to compare, so Vue leaves alone what the parser
built.

## Documentation

Guides, recipes and the API reference with live examples are on the
[docs site](https://horakdani.github.io/Temporeum_timeline_SDK/) — the Vue page is [Frameworks](https://horakdani.github.io/Temporeum_timeline_SDK/frameworks.html). Every
code block in this README is checked against a running template in CI
(`npm run test:examples -w @temporeum/timeline-docs`).

## Licence

MIT
