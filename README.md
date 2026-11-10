# Temporeum Timeline

[![CI](https://github.com/horakdani/Temporeum_timeline_SDK/actions/workflows/ci.yml/badge.svg)](https://github.com/horakdani/Temporeum_timeline_SDK/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@temporeum/timeline-element.svg)](https://www.npmjs.com/package/@temporeum/timeline-element)
[![runtime dependencies: 0](https://img.shields.io/badge/runtime%20dependencies-0-brightgreen.svg)](packages/core/package.json)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

An editable, accessible, responsive timeline for the web, covering spans from millennia down to seconds. Lanes never collide, every gesture has a keyboard equivalent, it renders on the server, and the engine has **zero runtime dependencies**.

[![Five thousand years, from the Nile to the Moon: the chronicle demo on the documentation's home page](.github/hero.png)](https://horakdani.github.io/Temporeum_timeline_SDK/)

**[Live demo and documentation →](https://horakdani.github.io/Temporeum_timeline_SDK/)**

## Your first timeline, step by step

All you need is [Node.js](https://nodejs.org/), which comes with `npm`, and a browser. Nothing else to install, no build step.

**1. Make a folder and install the package.** In a terminal:

```bash
mkdir my-timeline
cd my-timeline
npm init -y
npm install @temporeum/timeline-element
```

`npm init -y` creates `package.json`, the list of what the folder uses. `npm install` downloads the library into `node_modules/`.

**2. Save this page as `index.html` in the same folder:**

```html excerpt:template/html/index.html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Timeline — plain HTML</title>
    <!-- The library: the file npm installed next to this page. -->
    <script src="node_modules/@temporeum/timeline-element/dist/timeline-element.umd.js"></script>
  </head>
  <body style="margin: 0; font-family: system-ui, sans-serif">
    <main style="padding: 16px">
      <h1 style="font-size: 18px">Release plan</h1>

      <!-- The timeline. Its items are the JSON inside it; dates may be text here. -->
      <temporeum-timeline height="300" theme="auto" editable snap-ms="86400000" aria-label="Release plan">
        <script type="application/json">
          {
            "items": [
              { "id": "design", "start": "2026-03-02", "end": "2026-03-09", "label": "Design" },
              { "id": "build", "start": "2026-03-07", "end": "2026-03-21", "label": "Build" },
              { "id": "launch", "start": "2026-03-27", "label": "Launch" }
            ]
          }
        </script>
      </temporeum-timeline>

      <p id="log">Click an item, or drag it.</p>
    </main>

    <!-- Your code: the timeline tells you what the reader did. -->
    <script>
      const timeline = document.querySelector("temporeum-timeline");
      const log = document.querySelector("#log");

      timeline.addEventListener("item-click", (event) => {
        log.textContent = "You clicked " + event.detail.item.label;
      });
      timeline.addEventListener("item-moved", (event) => {
        log.textContent = event.detail.item.label + " now starts " + new Date(event.detail.to.start).toDateString();
      });
    </script>
  </body>
</html>
```

**3. Open it.** Double-click `index.html`, or type `open index.html` (macOS), `start index.html` (Windows) or `xdg-open index.html` (Linux).

You see three items on a timeline: two spans, and `Launch`, a single moment because it has no `end`. Click one, and the line under the timeline names it. Drag one, and the line says where it starts now. Drag the empty background to move through time; hold Ctrl and turn the mouse wheel (or pinch on a trackpad) to zoom.

The page has three parts:

- **The `<script src="node_modules/…">` tag** loads the library, which teaches the browser the `<temporeum-timeline>` tag.
- **`<temporeum-timeline>`** is the timeline. Its attributes set the height, the colour scheme (`theme="auto"` follows the system), dragging (`editable`) and dragging by whole days (`snap-ms`, a day in milliseconds). The JSON inside it lists the items: an `id`, a `start`, an optional `end` and a `label`.
- **The last `<script>`** is your code. The timeline reports what the reader does as events (`item-click`, `item-moved`), and the details are in `event.detail`.

The library never saves anything. Reload the page and the items are back where the JSON puts them. To keep an edit, send `event.detail.to` (the item's new times) to your server in the `item-moved` handler.

This page is the [`html` starter](packages/docs/templates/html) in the repository, and it is opened in a real browser on every check.

### Next: JavaScript files and `import`

A larger project keeps its code in `.js` files and writes `import { createTimeline } from "@temporeum/timeline-element"`. A browser alone cannot follow that `import`: the name is a folder inside `node_modules/`, and only a build tool knows where to find it. [Vite](https://vite.dev/) is one. In the same folder:

```bash
npm install --save-dev vite
```

Replace `index.html` with this page:

```html excerpt:template/vanilla/index.html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Timeline — plain JavaScript</title>
  </head>
  <body style="margin: 0; font-family: system-ui, sans-serif">
    <main style="padding: 16px">
      <h1 style="font-size: 18px">Release plan</h1>
      <button id="undo" type="button" disabled>Undo</button>
      <div id="timeline" style="height: 320px; margin-top: 8px"></div>
    </main>
    <script type="module" src="/main.js"></script>
  </body>
</html>
```

and save the code beside it as `main.js`:

```js excerpt:template/vanilla/main.js
import { createTimeline } from "@temporeum/timeline-element";

const DAY = 86_400_000;
const t = Date.UTC(2026, 2, 2);
const items = [
  { id: "design", label: "Design", laneId: "work", start: t, end: t + 7 * DAY },
  { id: "build", label: "Build", laneId: "work", start: t + 5 * DAY, end: t + 19 * DAY },
  { id: "review", label: "Review", laneId: "ship", start: t + 21 * DAY },
  { id: "launch", label: "Launch", laneId: "ship", start: t + 25 * DAY, end: t + 32 * DAY },
];
const lanes = [
  { id: "work", label: "Work" },
  { id: "ship", label: "Shipping" },
];

const timeline = createTimeline(document.querySelector("#timeline"), {
  items,
  lanes,
  ariaLabel: "Release plan",
  editing: { enabled: true, snapMs: DAY },
});

const undo = [];
const button = document.querySelector("#undo");
timeline.on("command", ({ command }) => {
  undo.push(command);
  button.disabled = false;
});
button.addEventListener("click", () => {
  timeline.applyCommand(undo.pop().inverse);
  button.disabled = undo.length === 0;
});
```

Then start Vite, and open the address it prints (<http://localhost:5173/>). Ctrl + C in the terminal stops it.

```bash
npx vite
```

Here the items are in two rows (`lanes`), and times are numbers: milliseconds since 1970, which `Date.UTC` gives. Every edit arrives as a `command`, and its `inverse` undoes it, which is all the Undo button does. This is the [`vanilla` starter](packages/docs/templates/vanilla).

[Getting started](https://horakdani.github.io/Temporeum_timeline_SDK/getting-started.html) goes on from here: plugins, the element's properties and events, server rendering. The [frameworks page](https://horakdani.github.io/Temporeum_timeline_SDK/frameworks.html) has a starter like these for React, Vue, Svelte, Angular, Next, Nuxt and Astro.

## Try it

The documentation site runs every example live: the timelines on its pages are the library, not pictures of it — the [home page's chronicle](https://horakdani.github.io/Temporeum_timeline_SDK/) of five thousand years, the [showcase](https://horakdani.github.io/Temporeum_timeline_SDK/showcase.html), the recipes and the guides, each with its example running.

To run the site on your own machine (Node 22.12 or later):

```bash
npm ci
npm run build -w @temporeum/timeline-docs
npm run serve -w @temporeum/timeline-docs
```

Then open <http://localhost:31737/site/>.

## Why another timeline

It is built to have five properties at once:

- **Editable.** You can drag and resize items. Each edit comes out as a command, and the command's `inverse` undoes it.
- **Genuinely responsive.** On a narrow screen the timeline turns vertical. That layout comes from the same code as the horizontal desktop one: the container's width decides, not a separate build.
- **Accessible.** Every gesture has a keyboard equivalent, and screen readers see the timeline as a listbox. The docs site and the demo pages are checked against WCAG 2.2 AA with axe, with 0 violations.
- **Light.** The engine does its own scale and tick maths and depends on nothing. A plain timeline's page loads 58.4 kB of JavaScript minified and gzipped, a Gantt chart's 66.3 kB. What a page does not use is a plugin it never downloads. The `<script>` tag's UMD file is the exception: it carries every plugin, nearly twice a plain timeline's page, so a page that minds its bytes imports the modules.
- **Typed.** The public surface has no `any`, and CI enforces it.

## Performance

The [benchmark](https://horakdani.github.io/Temporeum_timeline_SDK/benchmark.html) measures this library with real mouse input, in Chromium with a 4× CPU slowdown. Results for 10 000 items:

| Measurement | Result |
|---|---|
| First render | 0.27 s |
| Missed frames while panning | 0.9% |
| Missed frames while zooming (ctrl + wheel) | 3% |
| JavaScript heap after load | 6.7 MB |

The budget for missed frames is 5%. The [field benchmark](https://horakdani.github.io/Temporeum_timeline_SDK/benchmark-field.html) runs a timeline and a Gantt chart in Chromium, Firefox and WebKit. Both pages also say where it falls short: at this density (about 2 000 items across 1 440 px) Temporeum draws no item text. Up to about 1 000 items per screen width, labels that don't fit are shortened with an ellipsis instead of being dropped.

## Packages

| Package | What it is for |
|---|---|
| [`@temporeum/timeline-element`](packages/web-component) | `createTimeline` (the live timeline), `<temporeum-timeline>` (the custom element), and server rendering. **Start here.** |
| [`@temporeum/timeline-react`](packages/react) | `<Timeline>` and `useTimelineState` for React 18 and 19. |
| [`@temporeum/timeline-vue`](packages/vue) | `<Timeline>` and `useTimelineState` for Vue 3. |
| [`@temporeum/timeline-svelte`](packages/svelte) | `<Timeline>` and `timelineState` for Svelte 5. |
| [`@temporeum/timeline-angular`](packages/angular) | `<tl-timeline>` and `timelineState` for Angular, standalone and zoneless. |
| [`@temporeum/timeline-core`](packages/core) | The engine: geometry, layout, rendering, input, keyboard, loading and clustering. It needs no DOM, so you can build your own shell on it. |

All six packages are released together, always share one version, and follow [semantic versioning](https://horakdani.github.io/Temporeum_timeline_SDK/stability.html).

## Coming from vis-timeline?

[The migration guide](https://horakdani.github.io/Temporeum_timeline_SDK/guides/migrating-from-vis-timeline.html) maps vis-timeline options to their equivalents here, with a running example for each. It also lists what is not here yet.

## Contributing

Issues and pull requests are welcome; read [CONTRIBUTING.md](CONTRIBUTING.md) first. Security reports go through [SECURITY.md](SECURITY.md), not public issues. [GOVERNANCE.md](GOVERNANCE.md) explains how decisions are made, and [RELEASING.md](RELEASING.md) how a release happens.

## License

[MIT](LICENSE)
