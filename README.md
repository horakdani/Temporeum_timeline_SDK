# Temporeum Timeline

An editable, accessible, responsive timeline for the web, covering spans from millennia down to seconds. Lanes never collide, every gesture has a keyboard equivalent, it renders on the server, and the engine has **zero runtime dependencies**.

```bash
npm install @temporeum/timeline-element
```

```js
import { createTimeline, registerPlugin } from "@temporeum/timeline-element";
import { groupsPlugin } from "@temporeum/timeline-element/groups";

// Named rows are a plugin: a page that does not use them does not download them.
registerPlugin(groupsPlugin);

const timeline = createTimeline(document.querySelector("#timeline"), {
  items: [
    { id: "design", start: new Date("2026-03-02"), end: new Date("2026-03-09"), label: "Design", laneId: "work" },
    { id: "launch", start: new Date("2026-03-27"), end: new Date("2026-04-03"), label: "Launch", laneId: "ship" },
  ],
  groups: [
    { id: "work", label: "Work" },
    { id: "ship", label: "Shipping" },
  ],
  ariaLabel: "Release plan",
  editing: { enabled: true, snapMs: 86_400_000 },
});

// The library never saves anything itself: every edit arrives as a command, and your code decides what to do with it.
timeline.on("itemMoved", ({ item, to }) => console.log(item.id, "now starts", to.start));
```

**[Documentation →](packages/docs/site/pages/index.md)**

## Try it

The documentation site runs every example live: the timelines on its pages are the library, not pictures of it. Until the site is published, build it and open it on your own machine (Node 22.12 or later):

```bash
npm ci
npm run build -w @temporeum/timeline-docs
npm run serve -w @temporeum/timeline-docs
```

Then open <http://localhost:41737/site/> — the home page's chronicle of five thousand years, the [showcase](packages/docs/site/pages/showcase.md), the recipes and the guides, each with its example running.

## Why another timeline

Read-only timeline widgets already exist. This one is built to have five properties at once:

- **Editable.** You can drag and resize items. Each edit comes out as a command, and the command's `inverse` undoes it.
- **Genuinely responsive.** On a narrow screen the timeline turns vertical. That layout comes from the same code as the horizontal desktop one: the container's width decides, not a separate build.
- **Accessible.** Every gesture has a keyboard equivalent, and screen readers see the timeline as a listbox. The docs site and the demo pages are checked against WCAG 2.2 AA with axe, with 0 violations.
- **Light.** The engine does its own scale and tick maths and depends on nothing. A plain timeline's page loads 52.9 kB of JavaScript minified and gzipped, a Gantt chart's 60.8 kB; vis-timeline's standalone build is 155.8 kB. What a page does not use is a plugin it never downloads.
- **Typed.** The public surface has no `any`, and CI enforces it.

## How it compares

The [benchmark](packages/docs/site/pages/benchmark.md) runs this library and vis-timeline 8.5.6 on the same data, in the same browser, with real mouse input, on Chromium with a 4× CPU slowdown. Results for 10 000 items:

| | Temporeum | vis-timeline |
|---|---|---|
| First render | 0.72 s | 3.94 s |
| Missed frames while panning | 0.8% | 62% |
| Missed frames while zooming (ctrl + wheel) | 2% | 67% |
| JavaScript heap after load | 6.7 MB | 37.5 MB |

The benchmark page also lists where we lose. At this density (about 2 000 items across 1 440 px) Temporeum draws no item text, while vis-timeline draws labels on fewer, larger items. Up to about 1 000 items per screen width, labels that don't fit are shortened with an ellipsis instead of being dropped.

## Packages

| Package | What it is for |
|---|---|
| [`@temporeum/timeline-element`](packages/web-component) | `createTimeline` (the live timeline), `<temporeum-timeline>` (the custom element), and server rendering. **Start here.** |
| [`@temporeum/timeline-react`](packages/react) | `<Timeline>` and `useTimelineState` for React 18 and 19. |
| [`@temporeum/timeline-vue`](packages/vue) | `<Timeline>` and `useTimelineState` for Vue 3. |
| [`@temporeum/timeline-svelte`](packages/svelte) | `<Timeline>` and `timelineState` for Svelte 5. |
| [`@temporeum/timeline-angular`](packages/angular) | `<tl-timeline>` and `timelineState` for Angular, standalone and zoneless. |
| [`@temporeum/timeline-core`](packages/core) | The engine: geometry, layout, rendering, input, keyboard, loading and clustering. It needs no DOM, so you can build your own shell on it. |

All six packages are released together, always share one version, and follow [semantic versioning](packages/docs/site/pages/stability.md).

## Coming from vis-timeline?

[The migration guide](packages/docs/site/pages/guides/migrating-from-vis-timeline.md) maps vis-timeline options to their equivalents here, with a running example for each. It also lists, honestly, what is not here yet.

## Contributing

Issues and pull requests are welcome; read [CONTRIBUTING.md](CONTRIBUTING.md) first. Security reports go through [SECURITY.md](SECURITY.md), not public issues. [GOVERNANCE.md](GOVERNANCE.md) explains how decisions are made, and [RELEASING.md](RELEASING.md) how a release happens.

## License

[MIT](LICENSE)
