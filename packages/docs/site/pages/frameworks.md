# Frameworks

One starter project per framework. Each lives in the repository under `packages/docs/templates/`, and each is **built and run in a real browser on every check of the examples** — installed from the packed packages, the way a user installs them — so a template that stopped working fails the check rather than a reader.

{{templates}}

The **Open in StackBlitz** links open each template in the browser, straight from the repository. To run one on your own machine, copy its folder, or run it in place from the repository root.

```bash
cd packages/docs/templates/react
npm install
npm run dev
```

**Plugins.** The React, Vue, Svelte and Angular components take the same configuration as `createTimeline`, and draw through it, so the same plugins apply: the time tools, nested groups, item kinds and templates, other languages, the Gantt chart, the resource view and export are registered with `registerPlugin` — from `@temporeum/timeline-element`, or from the adapter, which hands the same function on — once, in the app's entry module — before the first timeline mounts, and on the server too when the app renders there. A configuration that needs a plugin that is not registered throws, naming the import. The registry is one for the page, even with two copies of the element of one release in it (an ESM and a CJS build, or a bundle that did not dedupe it) — two releases keep a registry each, since what a plugin hands the element changes between them — and the adapters depend on the element with a caret range (`^1.0.0`), so a package manager installs one. Install the element beside the adapter (`npm install @temporeum/timeline-react @temporeum/timeline-element`) to import a plugin: pnpm and Yarn PnP let an app import only the packages it lists. The types an app writes — `Item`, `Lane`, `Group`, `TimeMs` and every event's payload — come from the adapter itself. See [entry points](reference/entry-points.md#the-elements-entry-points); the React and Vue starters register the items plugin, for their items' content.

**Where the view starts.** In the four components the view and the selection are *defaults*: `defaultDomain` and `defaultSelectedIds` say where the timeline starts, and a re-render does not move them back — the reader's pan and click stay. To move the view or the selection from the app, call the instance's `zoomTo` and `select`. `items` is data: a new array is new items, so keep it in the app's state. Every other field is compared by what it says, so an `editing` object or a `groups` list written into the render anew each time is no change: a drag in progress goes on, and groups the reader reordered keep their order.

## Plain JavaScript

`createTimeline`, from a bundler (Vite in the template) or with an import map in a page that has none. The [getting started](getting-started.md) page covers the `<script>` tag.

```js excerpt:template/vanilla/main.js
import { createTimeline } from "@temporeum/timeline-element";

const timeline = createTimeline(document.querySelector("#timeline"), {
  items,
  lanes,
  ariaLabel: "Release plan",
  editing: { enabled: true, snapMs: DAY },
});
```

## React

`<Timeline>` and `useTimelineState`. The component does not re-render to draw; a component that shows the selection re-renders when the selection changes, and at no other time.

```jsx excerpt:template/react/src/App.jsx
export default function App() {
  const [timeline, setTimeline] = useState(null);
  const selected = useTimelineState(timeline, (state) => state.selectedIds);
  // …
}
```

### Item content

`renderItem` renders each item's content as React, into the box over the item, through a portal: it keeps its state and context for as long as the item is drawn — through pans, zooms and live data — and is unmounted when the item leaves the view. Only the items drawn have one. The content is a picture of the item; the pointer and the keyboard act on the item, and its `label` stays its accessible name ([theming](guides/theming.md#your-own-content-in-items)). It needs the items plugin, registered once:

```jsx excerpt:template/react/src/main.jsx
import { registerPlugin } from "@temporeum/timeline-element";
import { itemsPlugin } from "@temporeum/timeline-element/items";
// …
registerPlugin(itemsPlugin);
```

```jsx excerpt:template/react/src/App.jsx
function ItemCard({ item }) {
  return (
    <span>
      <b>{item.label}</b> · {item.data.owner}
    </span>
  );
}
// …
        renderItem={(item) => <ItemCard item={item} />}
```

## Vue

`<Timeline>` and `useTimelineState`, from `@temporeum/timeline-vue`. Every config field is an attribute, every event an emit (`@item-moved`); `@ready` hands over the instance. The component does not re-render to draw; a readout of the selection changes when the selection does, and at no other time.

```vue excerpt:template/vue/src/App.vue
<script setup>
import { Timeline, useTimelineState } from "@temporeum/timeline-vue";
const timeline = shallowRef(null);
const selected = useTimelineState(timeline, (state) => state.selectedIds);
</script>
<template>
    <Timeline
      :items="items"
      :lanes="lanes"
      @item-moved="onMoved"
      @ready="timeline = $event"
    >
      <!-- … -->
    </Timeline>
</template>
```

### Item content

The `#item` slot is each item's content as Vue, teleported into the box over the item, with the same rules as React's `renderItem`; the items plugin is registered in `main.js` as it is in React's `main.jsx`.

```vue excerpt:template/vue/src/App.vue
      <template #item="{ item }">
        <b>{{ item.label }}</b> · {{ item.data.owner }}
      </template>
```

The custom element works in Vue too: tell the compiler it is one (`isCustomElement`), and listen to its kebab-case events.

## Svelte

`<Timeline>` and `timelineState`, from `@temporeum/timeline-svelte` (Svelte 5, runes). Every config field is a prop, every event an `on…` prop; `bind:timeline` hands over the instance, and `timelineState` is a Svelte store of the part a component shows.

```svelte excerpt:template/svelte/src/App.svelte
<script>
  import { Timeline, timelineState } from "@temporeum/timeline-svelte";
  let timeline = $state(null);
  const selected = $derived(timelineState(timeline, (state) => state.selectedIds));
</script>
  <Timeline
    {items}
    {lanes}
    bind:timeline
  />
  <p aria-live="polite">{log} {$selected?.length ?? 0} selected.</p>
```

The `item` snippet (`{#snippet item(item)}…{/snippet}` inside `<Timeline>`) is each item's content as Svelte, rendered into the box over the item, with the same rules as React's `renderItem`.

## Angular

`<tl-timeline>` and `timelineState`, from `@temporeum/timeline-angular` (standalone, `OnPush`, zoneless). `[config]` takes the whole configuration, every event is an output by its own name, and `(ready)` hands over the instance; `timelineState` is a signal.

```ts excerpt:template/angular/src/app/app.ts
import { TimelineComponent, timelineState } from "@temporeum/timeline-angular";
  imports: [TimelineComponent],
      <tl-timeline [config]="config" (ready)="timeline.set($event)" (itemMoved)="onMoved($event)" />
  readonly timeline = signal<TimelineInstance | null>(null);
  readonly selected = timelineState(this.timeline, (state) => state.selectedIds);
```

`<ng-template tlItem let-item>…</ng-template>` inside `<tl-timeline>` (with `TimelineItemDirective` imported) is each item's content as an Angular template, rendered into the box over the item, with the same rules as React's `renderItem`.

## Next, Nuxt, Astro, SvelteKit, Angular SSR

Server-rendered and hydrated; see [server rendering](guides/server-rendering.md) for what each one needs and why.
