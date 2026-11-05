# Getting started

Install the element package. It carries the live timeline, the custom element and the server renderer, and it brings the engine with it.

```bash
npm install @temporeum/timeline-element
```

## The live timeline: `createTimeline`

Give it a container and a configuration; it measures the container, draws, and listens to pointer, wheel and keyboard. The [example on the home page](index.md) is this:

```js excerpt:example/quick-start
import { createTimeline, registerPlugin } from "@temporeum/timeline-element";
import { groupsPlugin } from "@temporeum/timeline-element/groups";

registerPlugin(groupsPlugin);

const timeline = createTimeline(document.querySelector("#timeline"), {
  items,
  groups,
  ariaLabel: "Release plan",
  editing: { enabled: true, snapMs: 86_400_000 },
});

// The library never saves: an edit comes out as a command, and it is yours.
timeline.on("itemMoved", ({ item, to }) => {
  // …
});
```

An item is an `id`, a `start`, and optionally an `end`, a `label` and a `laneId`: the row it is drawn in. A group is a row with its name drawn as a header (`groups`, from the groups plugin); plain `lanes` are rows without one, named only in each item's accessible name. Times are epoch milliseconds or `Date` objects — not strings: parse them first. Without an `end` an item is an instant. The container needs a height; the timeline takes the container's (or `height` in the configuration, 300 px by default).

Change anything later with `timeline.update({ … })` — only the keys you pass change — and call `timeline.destroy()` when the container goes away.

## Plugins

Out of the box the timeline draws, pans and zooms, moves and resizes items, selects, clusters, loads windows of a fetched source, takes live changes, exports SVG and renders on a server — in English, left to right. The rest is plugins, each on an entry point of the element's own, so a page downloads only what it imports: the time tools (`/tools`), nested groups (`/groups`), box, point and background items, templates and adding and removing (`/items`), other languages, directions and calendars (`/intl`), the Gantt chart (`/gantt`), the resource view (`/resources`), and PNG, PDF and print (`/export`). Register a plugin once, before the first timeline:

```js excerpt:example/time-tools
import { createTimeline, registerPlugin } from "@temporeum/timeline-element";
import { toolsPlugin } from "@temporeum/timeline-element/tools";

// The time tools are a plugin: registered once, before the first timeline.
registerPlugin(toolsPlugin);
```

A configuration that needs a plugin that is not registered throws a `TypeError` naming the import to add. The [entry points](reference/entry-points.md#the-elements-entry-points) page lists which option needs which plugin. The `<script>`-tag build below registers every plugin on load.

## The custom element, in plain HTML

No bundler, no build. The configuration can travel as a JSON child, where dates may be text:

::: example element-html

With a `<script>` tag instead of a module, use the UMD file, which carries the engine and registers the element when it loads. It carries every plugin too, so it is nearly twice a plain timeline's page of modules; a page that minds its bytes imports the modules instead:

```html excerpt:example/element-html
<temporeum-timeline height="280" theme="auto" aria-label="Release plan">
  <script type="application/json">
    {
      "items": [
        { "id": "a", "start": "2026-03-01", "end": "2026-03-05", "label": "Design" },
        // …
      ]
    }
  </script>
</temporeum-timeline>
```

The script tag is `<script src="https://unpkg.com/@temporeum/timeline-element@1"></script>`: the `@1` keeps a page on 1.x, so a 2.0 cannot change it unasked. That is for trying it out: a range follows every new 1.x, so the file can change under the page. In production, pin the exact version (`@1.0.0`) and add an `integrity` attribute with the file's hash and `crossorigin="anonymous"` — `openssl dgst -sha384 -binary timeline-element.umd.js | openssl base64 -A` gives it — or serve the file from your own origin. Everything the package and its entry points export is on one global, `window.TemporeumTimelineElement` — `const { createTimeline, mountStory } = TemporeumTimelineElement;` — with every plugin already registered. Items, lanes, hooks and the selection are properties (`timeline.items = …`); every event is dispatched under its kebab-case name (`item-moved`, `selection-changed`) with the payload as `detail`, which is the spelling Vue's `@item-moved` and Angular's `(item-moved)` reach.

## React

```bash
npm install @temporeum/timeline-react @temporeum/timeline-element
```

```jsx excerpt:template/react/src/App.jsx
import { Timeline, useTimelineState } from "@temporeum/timeline-react";
import { useState } from "react";

  const [timeline, setTimeline] = useState(null);
  const selected = useTimelineState(timeline, (state) => state.selectedIds);
      <Timeline
        items={items}
        lanes={lanes}
        editing={{ enabled: true, snapMs: DAY }}
        onItemMoved={({ item, to }) => setLog(`${item.label} moved to ${new Date(to.start ?? item.start).toDateString()}`)}
        timelineRef={setTimeline}
      />
```

Every configuration field is a prop and every event an `on…` prop. The component does not re-render to draw — React's `<Profiler>` counts 0 commits during a pan — and `useTimelineState` re-renders a component only when the part of the state it selects changes. React examples are not live on this site, because React ships no browser module; the [React template](frameworks.md) is the runnable one.

## Next

- [Items and lanes](guides/items-and-lanes.md): what an item can be.
- [Editing](guides/editing.md): commands, undo, rules.
- [Frameworks](frameworks.md): a starter for yours.
