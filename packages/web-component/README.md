# @temporeum/timeline-element

The timeline as a custom element, as a live instance, and as server-rendered
markup — one package, built on
[`@temporeum/timeline-core`](../core/README.md).

```bash
npm install @temporeum/timeline-element
```

## Plain HTML

No bundler, no build: the UMD file carries the core and registers the
element on load — `<script src="https://unpkg.com/@temporeum/timeline-element"></script>`
once the package is on npm, or `dist/timeline-element.umd.js` from the package.

```html excerpt:example/element-html
<temporeum-timeline height="280" theme="auto" aria-label="Release plan">
  <script type="application/json">
    {
      "items": [
        { "id": "a", "start": "2026-03-01", "end": "2026-03-05", "label": "Design" },
        { "id": "b", "start": "2026-03-04", "end": "2026-03-12", "label": "Build" },
        { "id": "c", "start": "2026-03-16", "label": "Launch" }
      ]
    }
  </script>
</temporeum-timeline>
```

Dates in the JSON child may be text; everywhere else they are `Date` objects
or epoch milliseconds — not strings.

## Any framework that renders elements

```js excerpt:example/element-html
import "@temporeum/timeline-element/define";

const timeline = document.querySelector("temporeum-timeline");
timeline.addEventListener("item-click", (event) => {
  console.log("clicked", event.detail.item.label);
});
```

| Attribute | Means |
|---|---|
| `orientation` | `horizontal`, `vertical`, `auto` |
| `density` | `comfortable`, `compact`, `dense`, `auto` |
| `theme` | `light`, `dark`, `auto` |
| `start`, `end` | the initial view: epoch ms, or anything `Date.parse` reads |
| `height` | the drawing's height in px (also CSS: `temporeum-timeline { height: 480px }`) |
| `locale`, `time-zone`, `aria-label`, `aria-labelledby` | formatting and the accessible name (`aria-labelledby` names the page's elements whose text it is) |
| `breakpoint`, `pack-mode` | when `auto` turns vertical; how items share a lane |
| `cluster` | merge items too small to see one by one |
| `editable`, `multi-select`, `snap-ms` | editing |
| `touch-action` | `own` (the default) claims every touch gesture; `cooperative` leaves vertical scrolling to the page, for a timeline inside an article |

Items, lanes, hooks and the selection are **properties** (`items`, `lanes`,
`hooks`, `selectedIds`); `orientation`, `density`, `theme`, `height` and
`editable` are properties too, which win over their attributes (`undefined`
hands back to the attribute), so Angular's `[theme]` and Lit's `.theme=`
work. `config` takes any [`TimelineConfig`](src/config.ts) at once and
replaces what the `config` before it said: a field it leaves out goes back
to the attribute or the default, and a named property set on its own stays. A property set before the element is defined is
not lost.

`document.createElement("temporeum-timeline")` is typed as the element, and
`addEventListener("item-moved", …)` hands a `CustomEvent` typed by its
payload (`TimelineElementEventMap`). The package ships a
[Custom Elements Manifest](https://github.com/webcomponents/custom-elements-manifest)
(`customElements` in its `package.json`) for editors and Storybook.

Every event is dispatched under its kebab-case name, bubbling out of the
shadow root, with the payload as `detail`: `item-click`, `item-dbl-click`,
`selection-changed`, `viewport-changed`, `layout-changed`, `item-moved`,
`item-resized`, `timeline-command`, `density-changed`, `orientation-changed`,
`cluster-opened`, `jump-request`. Kebab-case because it is the spelling Vue's
`@item-moved`, Angular's `(item-moved)` and `addEventListener` all reach.
`element.timeline.on("itemMoved", …)` is the instance itself. The
one exception to the rule is the instance's `command`, which is
`timeline-command` on the element: `command` is the platform's own event (a
`<button commandfor>` fires it at its target).

The library never saves. An edit is shown while it happens and kept when it
ends; what to do with `event.detail.command` is yours. Its `inverse` is the
undo: `element.timeline.applyCommand(command.inverse)`.

## The instance: `createTimeline`

The element and the React component are shells around this. Use it directly
when you want no element at all:

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

`timeline.update({ … })` changes only the keys it is given, `zoomTo`,
`zoomBy` and `scrollTo` move the view (reported with the reason `"api"`), and
`destroy()` lets go of the container.

The time tools are options too, with the tools plugin (below): `hiddenDates`
(nights, weekends — the axis runs in shown time), `timeBars` (lines the reader
drags or moves with the arrows, `timeBarMoved`), `minimap`, `rangeSelect`
(`rangeSelected`), `laneHeaders`, `zoomPresets`, `tooltip` and `rolling`. Live
data needs no plugin — `addItems`, `updateItems`, `removeItems`,
`changeItems` — and draws the frame a full reload would, packing only the
lanes a change touched. See the time tools guide.

Exports need no server: `exportSvg()` and `exportPng()` give the view as a
file, `exportPdf()` the whole range as a PDF of the library's own (vector,
selectable text), and `print()` sends the same pages to the browser's print —
the lanes cut between rows, every item on exactly one page. See the export and
print guide.

**Plugins.** The parts a plain timeline does not need are on entry points of
their own, so a page downloads them only when it imports them:

| Entry point | Plugin | Also exports | Needed for |
|---|---|---|---|
| `/tools` | `toolsPlugin` | — | `hiddenDates`, `timeBars`, `rolling`, `zoomPresets`, `minimap`, `rangeSelect`, `laneHeaders`, `tooltip` |
| `/groups` | `groupsPlugin` | — | `groups`: nested groups, collapsing, reordering, the header tree (and its server markup) |
| `/items` | `itemsPlugin` | — | `box`, `point` and `background` items, `template`, `editing.add`, `editing.remove`, `editing.drop` |
| `/intl` | `intlPlugin` | — | `strings`, `calendar`, `direction: "rtl"` and `"auto"` |
| `/gantt` | `ganttPlugin` | `mountTaskGrid` (the task table) | `gantt`: arrows, progress, baselines, milestones |
| `/resources` | `resourcesPlugin` | `mountBacklog` (the unscheduled tasks) | `resources` |
| `/export` | `exportPlugin` | — | `exportPng`, `exportPdf`, `print` |

Each imports its part of the core (`/tools`, `/groups`, `/items`, `/intl`,
`/gantt`, `/resources`, `/export`). Register plugins once, for the page:

```js excerpt:example/gantt
import { createTimeline, registerPlugin } from "@temporeum/timeline-element";
import { ganttPlugin, mountTaskGrid } from "@temporeum/timeline-element/gantt";

// The Gantt chart is a plugin: registered once, before the first timeline.
registerPlugin(ganttPlugin);
```

Every instance, every `<temporeum-timeline>` and the server renderer draw
with what is registered. A configuration that needs a plugin that is not
registered throws a `TypeError` where the timeline is created, updated
(`update`, `setItems`, `addItems` with such an item) or server-rendered, and
the instance is left as it was — `The tooltip option needs the tools plugin:
import { toolsPlugin } from "@temporeum/timeline-element/tools" and call
registerPlugin(toolsPlugin) before the timeline draws`; `exportPng`,
`exportPdf` and `print` throw the same way when called. The items of a
fetched source are checked when they arrive. The `<script>`-tag build
registers every plugin on load.

With `<temporeum-timeline>` already in the page — server-rendered, or written
in the HTML — register the plugins before the element is defined.
`import "@temporeum/timeline-element/define"` runs before the code of the
module that imports it, so a `registerPlugin(...)` below it comes too late:
in that module, call `defineTimelineElement()` after `registerPlugin(...)`
instead.

Without any plugin the element draws, pans, zooms (wheel, pinch, keys),
moves and resizes items, selects, clusters, loads windows of a fetched
source, takes live data, exports SVG, and renders on a server and hydrates —
in English, left to right, on the Gregorian axis. For that it loads the
core's main entry point, `/dom`, `/live` and `/words`, and not the core's
`/tools`, `/groups`, `/items` or `/intl`. Measured the way the field benchmark
measures (minified, gzipped, per file), a plain timeline's page loads
52.94 kB of JavaScript, and a Gantt chart's (with `/gantt`) 60.76 kB. An
import map needs `@temporeum/timeline-core/live` and `/words`, and the
subpaths of the plugins it uses.

Other languages, with the intl plugin: `direction: "rtl"` mirrors the
timeline — time flows from the right, and the pointer, the wheel and the
arrows follow the mirror, while text still reads the right way; `strings`
replaces any word the library says (the names screen readers hear, the
tools' labels) from `DEFAULT_STRINGS`, with dates and numbers from `Intl` in
`locale`; and `calendar` puts the axis's months and years where a calendar's
own begin — Hebrew, Islamic, Persian, Chinese, any calendar `Intl` knows.
Without it, the English words are the base's own. See the
internationalisation guide.

Calendars of events: `mountCalendarView(container, { events })` from
`@temporeum/timeline-element/calendar` shows a week or a day — overlapping
events side by side, every event reached from the keyboard, `Enter` the same
as a click — and the core's `/calendar` reads and writes iCalendar files and
expands RFC 5545 rules, for the view and for the timeline's `items`
(`recurringSource`). It is a subpath of its own, so a timeline alone does not
download it. See the calendar guide.

It is also an **external store**: `subscribe(listener)` and `getSnapshot()`
are the shape `useSyncExternalStore` (or any signal library) expects. The
snapshot is frozen, gets a new identity only when something in it changed,
and changes at most once per drawn frame — sixty pointer events in one frame
are one notification.

## Server rendering

```js excerpt:example/server-rendering
import { renderTimelineHtml } from "@temporeum/timeline-element";

const html = renderTimelineHtml(config, { width: 960 });
```

The drawing is in a declarative shadow root, so it shows — and reads, and
takes focus — before any script runs. The configuration it was drawn from
travels beside it. When the element is defined on the client, it takes the
server's nodes over instead of drawing again.

**Astro:** `<Fragment set:html={html} />` and a `<script>` that imports
`@temporeum/timeline-element/define`.

**Nuxt / Vue:** use the Vue component,
[`@temporeum/timeline-vue`](../vue/README.md); it server-renders itself and
hydrates without a second drawing. The bare element in Vue works the same
way it does: give `renderTimelineHtml`'s markup to a node **on the server
only** (a plain `v-html` is written again while hydrating, and a browser
builds no declarative shadow root from `innerHTML`), register the element
from a client plugin, and tell Vue it is an element
(`vue.compilerOptions.isCustomElement`).

Every framework path is checked in CI (`npm run test:ssr -w
@temporeum/timeline-docs`) with the packed tarballs: Next, Nuxt, Astro,
SvelteKit and Angular.

## Formats

| Entry | Format | For |
|---|---|---|
| `dist/index.mjs` / `.cjs` | ESM / CJS | bundlers, Node; the core stays an external dependency |
| `dist/define.mjs` / `.cjs` | the `/define` subpath | registering the element (the only side effect) |
| `dist/calendar.mjs` / `.cjs` | the `/calendar` subpath | the week and day views (`mountCalendarView`) |
| `dist/gantt.mjs` / `.cjs` | the `/gantt` subpath | the Gantt plugin (`ganttPlugin`) and the task table (`mountTaskGrid`) |
| `dist/resources.mjs` / `.cjs` | the `/resources` subpath | the resource view plugin (`resourcesPlugin`) and the backlog (`mountBacklog`) |
| `dist/export.mjs` / `.cjs` | the `/export` subpath | PNG, PDF and print (`exportPlugin`) |
| `dist/tools.mjs` / `.cjs` | the `/tools` subpath | the time tools plugin (`toolsPlugin`) |
| `dist/groups.mjs` / `.cjs` | the `/groups` subpath | the nested groups plugin (`groupsPlugin`) and the group-header functions |
| `dist/items.mjs` / `.cjs` | the `/items` subpath | item kinds, templates, adding and removing (`itemsPlugin`) |
| `dist/intl.mjs` / `.cjs` | the `/intl` subpath | other languages, directions and calendars (`intlPlugin`) |
| `dist/timeline-element.umd.js` | UMD | `<script>` tag: core included, every plugin and the element registered |

## Documentation

Guides, four recipes (a Gantt plan, an event log, a chronology, a roadmap),
starter projects for six frameworks and the API reference, with live examples,
are on the docs site (`npm run build -w @temporeum/timeline-docs`, then
`packages/docs/dist`). Every code block in this README is checked against a
running example in CI (`npm run test:examples -w @temporeum/timeline-docs`).
