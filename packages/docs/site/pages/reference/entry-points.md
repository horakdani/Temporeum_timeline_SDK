# Entry points

One package, several entry points: you pay for what you import.

## The entry points

`@temporeum/timeline-core` is a single package. What it can do grows release by release — the roadmap adds Gantt dependencies, a scheduler, resource views and calendars — but each of those arrives on its own entry point, so a timeline that uses none of them does not download them.

| Entry point | Import | Size budget | What it is |
|---|---|---|---|
| `index` | `@temporeum/timeline-core` | 31 kB on its own | The engine: geometry, layout, rendering, input, editing, accessibility, clustering, windowed data. |
| `dom` | `@temporeum/timeline-core/dom` | 4 kB on top of the core | The browser binding: mounts a scene into live SVG, wires pointer and keyboard input, observes size. |
| `groups` | `@temporeum/timeline-core/groups` | 2 kB on top of the core | Nested groups: the tree as lanes, collapsing, reorder commands, the tree's keys. See [groups](../guides/groups-and-item-kinds.md). |
| `items` | `@temporeum/timeline-core/items` | 4 kB on top of the core | Item kinds (box, point, background), add and remove as commands, sanitised HTML templates. |
| `gantt` | `@temporeum/timeline-core/gantt` | 4 kB on top of the core | Dependency arrows (routing, culling, the layer under the items), progress, baselines, milestones, the predecessor and successor keys, the task table's rows. See [Gantt charts](../guides/gantt.md). |
| `schedule` | `@temporeum/timeline-core/schedule` | 4 kB on top of the core | The scheduler: dependencies with lags, constraints, working calendars, slack and the critical path, cycles found and named, the result as one reversible command. See [scheduling](../guides/scheduling.md). |
| `resources` | `@temporeum/timeline-core/resources` | 3 kB on top of the core | The resource view: the load of every resource, exact, against its capacity; the overload bands, the load lanes and their layer; overbooked assignments marked and named; the unscheduled tasks. See [resources](../guides/resources.md). |
| `tools` | `@temporeum/timeline-core/tools` | 6 kB on top of the core | The time tools: hidden dates (fixed and repeating, on the zone's calendar) as the `TimeWarp` the core takes; time bars, the overview strip and range selection — each a gesture and its keys into one function; a rolling window, zoom presets, sticky lane headers; live data (`applyItemChanges`, `relayout`, the same functions as `live`'s). See [time tools](../guides/time-tools.md). |
| `export` | `@temporeum/timeline-core/export` | 7.5 kB on top of the core | Export with no server: a standalone SVG and a PNG of a frame, a PDF writer of its own (no dependency; vector, selectable text), and print — `printPages` cuts the whole range into pages between rows, each item on exactly one, and `mountPrintView` puts them in front of the browser's print. See [export and print](../guides/export.md). |
| `intl` | `@temporeum/timeline-core/intl` | 4 kB on top of the core | Other languages, directions and calendars: `mirrorScene` draws a frame right to left (the input half is `attachInput`'s `direction`); `DEFAULT_STRINGS` is every word the library says, with `sayIn`, `describeHooks` and `pseudoStrings`; `calendarTicks` puts the axis's months and years where a calendar's own begin, and `calendarTickLabel` writes ticks in a locale. See [internationalisation](../guides/internationalisation.md). |
| `live` | `@temporeum/timeline-core/live` | 2 kB on top of the core | Live data alone: `applyItemChanges` and `relayout` — a change to some items, and the layout after it with only the lanes it touched packed again. `tools` exports the very same functions; this entry point is for a host that takes live changes and shows none of the time tools. |
| `words` | `@temporeum/timeline-core/words` | 2 kB on top of the core | The library's words in English: `DEFAULT_STRINGS`, `resolveStrings`, `sayIn`, `fill` and `formatAmount`. `intl` exports the very same objects, with what another language needs on top (`pseudoStrings`, `mirrorScene`, `describeHooks`, `calendarTicks`, …). |
| `calendar` | `@temporeum/timeline-core/calendar` | 12 kB on top of the core | Calendars of events: RFC 5545 recurrence rules in the library's own code, with zones and clock changes (`occurrences`, `parseRRule`); events as items (`expandEvents`, `recurringSource`); iCalendar in and out (`parseICal`, `formatICal`); the week and day views as pure functions (`layoutDays`, `calendarScene`, `calendarKeyStep`, `calendarHit`). The element mounts the views from `@temporeum/timeline-element/calendar`. See [calendar](../guides/calendar.md). |
| `vis-compat` | `@temporeum/timeline-core/vis-compat` | 6 kB on top of the core | Moving over from vis-timeline: `fromVis` turns vis-timeline's items, groups and options into a configuration by vis-timeline's own rules, with a warning for what did not carry over; `parseVisTime` reads a time as vis-timeline does. See [migrating from vis-timeline](../guides/migrating-from-vis-timeline.md). |
| `story` | `@temporeum/timeline-core/story` | 5 kB on top of the core | Stories told slide by slide: `fromTimelineJS` turns TimelineJS's JSON into items, lanes and eras, each slide in `data.story`, with a warning for what did not carry over; `fromTimelineSheet` reads its Google Sheets template from the CSV (`sheetCsvUrl`, `readTimelineSheet`, `parseCsv`); `storyMedia` sorts a media link; `storyDateText` writes a date to its precision. See [storytelling](../guides/storytelling.md). |

The [element](../getting-started.md) and the [framework adapters](../frameworks.md) import the engine, `dom`, `live` and `words` for you; `groups`, `items`, `tools` and `intl` come with the element's plugins of the same names, below. The scheduler you import yourself: only you decide when to schedule. The vis-timeline layer you import once, while you move over; the story's import, with the panel that tells it.

## The element's entry points

The element follows the same rule: the parts a plain timeline does not need are plugins, each on an entry point of its own, and each imports its part of the core. A page downloads a plugin only when it imports it. Without any plugin the element draws, pans, zooms (wheel, pinch, keys), moves and resizes items, selects, clusters, loads windows of a fetched source, takes live data (`addItems`, `updateItems`, `removeItems`, `changeItems`), exports SVG, and renders on a server and hydrates — in English, left to right, on the Gregorian axis.

| Entry point | Import | What it is |
|---|---|---|
| the element | `@temporeum/timeline-element` | `createTimeline`, `<temporeum-timeline>`, the server renderer, `registerPlugin`. |
| `define` | `@temporeum/timeline-element/define` | Registers `<temporeum-timeline>`; import it for the side effect. |
| `gantt` | `@temporeum/timeline-element/gantt` | `ganttPlugin` — the `gantt` option: arrows, progress, baselines, milestones, `[` and `]` — and the task table, `mountTaskGrid`. Imports the core's `gantt`. See [Gantt charts](../guides/gantt.md). |
| `resources` | `@temporeum/timeline-element/resources` | `resourcesPlugin` — the `resources` option: load lanes, overload bands, overbooked assignments — and the unscheduled tasks, `mountBacklog`. Imports the core's `resources`. See [resources](../guides/resources.md). |
| `export` | `@temporeum/timeline-element/export` | `exportPlugin` — `exportPng`, `exportPdf` and `print` (`exportSvg` needs no plugin). Imports the core's `export`. See [export and print](../guides/export.md). |
| `tools` | `@temporeum/timeline-element/tools` | `toolsPlugin` — the time tools: `hiddenDates`, `timeBars`, `rolling`, `zoomPresets`, `minimap`, `rangeSelect`, `laneHeaders`, `tooltip`. Imports the core's `tools`. See [time tools](../guides/time-tools.md). |
| `groups` | `@temporeum/timeline-element/groups` | `groupsPlugin` — the `groups` option: nested groups, collapsing, reordering, the tree of headers, and the tree's markup on the server. Imports the core's `groups`. See [groups](../guides/groups-and-item-kinds.md). |
| `items` | `@temporeum/timeline-element/items` | `itemsPlugin` — `box`, `point` and `background` items, the `template` option, and `editing.add`, `editing.remove` and `editing.drop`. Moving and resizing need no plugin. Imports the core's `items`. See [item kinds](../guides/groups-and-item-kinds.md) and [editing](../guides/editing.md). |
| `intl` | `@temporeum/timeline-element/intl` | `intlPlugin` — the `strings` option, `calendar`, and `direction: "rtl"` and `"auto"`. The English words need no plugin. Imports the core's `intl`. See [internationalisation](../guides/internationalisation.md). |
| `calendar` | `@temporeum/timeline-element/calendar` | The week and day views, `mountCalendarView`. Imports the core's `calendar`. See [calendar](../guides/calendar.md). |
| `story` | `@temporeum/timeline-element/story` | The story panel, `mountStory`: one slide at a time beside the timeline, the two moving together; `storyHtml`, `storyCss`, `STORY_STRINGS`. Not a plugin: nothing to register. Imports the core's `story`. See [storytelling](../guides/storytelling.md). |

A plugin is registered once, for the page — every instance, every element and the server renderer draw with what is registered:

```js excerpt:example/gantt
import { createTimeline, registerPlugin } from "@temporeum/timeline-element";
import { ganttPlugin, mountTaskGrid } from "@temporeum/timeline-element/gantt";

// The Gantt chart is a plugin: registered once, before the first timeline.
registerPlugin(ganttPlugin);
```

A configuration that asks for a plugin that is not registered — `gantt` without `ganttPlugin`, `tooltip` without `toolsPlugin`, an item of kind `"point"` without `itemsPlugin` — throws a `TypeError` where the timeline is created, updated (`update`, `setItems`, `addItems`) or rendered on a server, naming the import that is missing, and the instance is left as it was; it does not quietly draw a plain timeline. The items of a fetched source (`items` as a function) are checked when they arrive. The `<script>`-tag build (`timeline-element.umd.js`) carries every plugin and registers them on load.

## How the budgets are measured

Every budget is minified and gzipped, for the whole entry point (`import *`), and every one is a gate in the library's CI: a change that crosses one does not merge.

- **The core** is measured on its own, because a server-side renderer or a canvas host can use it with nothing else.
- **Every other entry point** is measured as what it adds: the core and the entry point together, minus the core. None of them works without the core — they import it — so the price you see is the price you pay.

Two consequences, both checked by the same gates:

- **Shared code ships once.** An entry point imports the core's code from the core's own file instead of carrying a copy, so loading the core and an entry point together never downloads the same function twice.
- **Unused code drops out.** The package is marked `"sideEffects": false`, and a bundler keeps only what your code reaches: importing one function from the core costs a fraction of the whole entry point.

## Formats

Each entry point ships as an ES module (`.mjs`) and as CommonJS (`.cjs`), each with its own type declarations, plus a self-contained UMD file for a plain `<script>` tag (`dist/<entry point>.umd.js`; the core's global is `TemporeumTimeline`, the browser binding's `TemporeumTimelineDom`, then `TemporeumTimelineGroups`, `TemporeumTimelineItems`, `TemporeumTimelineGantt` and `TemporeumTimelineSchedule`). The UMD files cannot share code with each other, so each carries what it needs. Import through the package name, not through `dist/` paths: the [stability policy](../stability.md) covers the entry points, not the file layout.
