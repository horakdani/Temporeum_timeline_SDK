# Server rendering

The engine is DOM-free, so a server draws the same picture the browser would, and the page shows — and reads, and takes focus — before any script runs. When the element is defined on the client it **takes the server's nodes over** instead of drawing a second timeline: nothing flashes, and a focus the reader already put on the timeline survives.

::: example server-rendering

```js excerpt:example/server-rendering
import { renderTimelineHtml } from "@temporeum/timeline-element";

const html = renderTimelineHtml(config, { width: 960 });
```

The string is a `<temporeum-timeline>` with the drawing in a declarative shadow root and the configuration it was drawn from beside it, as JSON. The server cannot measure the container, so it draws at `width` (960 by default); the client redraws at the real width on its first frame.

## Plugins on the server

`registerPlugin` applies to the server renderer as it does to the browser: `renderTimelineHtml` and `renderTimelineSvg` draw with what is registered in the server's own process, and a configuration that needs a plugin that is not registered there throws the same `TypeError`, naming the import. So a server that renders `groups` (and the markup of their tree), `minimap` or `laneHeaders` (both drawn in the frame), `hiddenDates`, item kinds or a template, `gantt`, `resources`, `strings`, `calendar` or `direction: "rtl"` registers the same plugins as the client — `groupsPlugin`, `toolsPlugin`, `itemsPlugin`, `ganttPlugin`, `resourcesPlugin`, `intlPlugin` — once, in a module that runs before the first render. The client registers them too, before the element is defined or the first timeline is created, so that it can take over the frame it was given. See [entry points](../reference/entry-points.md#the-elements-entry-points) for which option needs which plugin.

## Frameworks

Each of these is built and run against the packed packages on every check — Next, Nuxt and Astro as [templates](../frameworks.md) too — and all five are checked for hydration on every gate run: the drawing is in the raw HTML, the client keeps the server's nodes, and a click selects.

**Next (App Router).** `<Timeline>` from `@temporeum/timeline-react` server-renders and hydrates; its bundle starts with `"use client"`. Render it from a server component, and pass functions from a client component:

```jsx excerpt:template/next/app/page.jsx
import { Timeline } from "@temporeum/timeline-react";

export default function Page() {
  return (
    <main>
      <Timeline items={items} lanes={lanes} height={320} ariaLabel="Release plan" />
    </main>
  );
}
```

**Astro.** Print the string, and register the element in a client script:

```astro excerpt:template/astro/src/pages/index.astro
import { renderTimelineHtml } from "@temporeum/timeline-element";
const html = renderTimelineHtml({ items, height: 320, ariaLabel: "Release plan" }, { width: 960 });
<Fragment set:html={html} />
<script>
  import "@temporeum/timeline-element/define";
</script>
```

With `<temporeum-timeline>` already in the page — server-rendered, or written in the HTML — register the plugins before the element is defined. `import "@temporeum/timeline-element/define"` runs before the code of the module that imports it, so a `registerPlugin(...)` below it comes too late: in that module, call `defineTimelineElement()` after `registerPlugin(...)` instead.

**Nuxt and Vue.** The Vue component server-renders itself: nothing else is needed.

```vue excerpt:template/nuxt/app/app.vue
<script setup>
import { Timeline } from "@temporeum/timeline-vue";
</script>
<template>
    <Timeline :items="items" :lanes="lanes" :height="320" aria-label="Release plan" :ssr-width="960" />
</template>
```

The drawing goes into the server's markup only. A plain `v-html` does not hydrate: Vue 3.5 writes a dynamic `innerHTML` again while hydrating, and that is a second drawing, not the parser's first. On the client the component's node has no children for Vue to compare, so Vue leaves alone what the parser built. The same holds for the bare element in Vue: give `renderTimelineHtml`'s markup to a node on the server only, and register the element from a client plugin.

**SvelteKit.** The Svelte component server-renders itself, through `{@html}` of one string computed once — on the server, and again on the hydrating client, where Svelte takes the server's nodes for it and never writes it again. Nothing else is needed: put `<Timeline {...config} bind:timeline />` in a page.

**Angular.** `<tl-timeline>` writes the drawing on the server (`@angular/ssr`) into a node its template leaves empty; with `provideClientHydration()` the client keeps the server's DOM, and the instance takes those nodes over after the first render. Nothing else is needed. The component works without zone.js (`provideZonelessChangeDetection()`).

## Without a framework

`renderTimelineSvg(config, { width })` gives the drawing alone, and the engine's `renderToSvgString(renderTimeline(…).scene)` is the same at the lowest level. In the browser, the engine's `mountScene(container, { hydrate: true })` adopts an existing `<svg>`; the element and the React component call it for you.
