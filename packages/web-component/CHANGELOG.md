# Changelog

## 1.0.0 — Unreleased

The first release, on 1.0.0 of `@temporeum/timeline-core`. From here on the package follows [semantic versioning](https://github.com/horakdani/Temporeum_timeline_SDK/blob/main/packages/docs/site/pages/stability.md): nothing public is removed before 2.0.

### The timeline

- **`createTimeline(container, config)`**: the live timeline. It measures, draws once per frame in the engine's scene space, and takes pointer, wheel and keyboard input. It also covers editing, async items and clusters, and an external store (`subscribe`, `getSnapshot`) that notifies at most once per frame.
- **The host:** a container that is not positioned is made `position: relative` while the timeline lives (and let go of at `destroy()`), so the tools and the group layer lie on the drawing and not on whatever ancestor is positioned. The default tooltip reads dates before year 1 with their era.
- **The instance:**
  - live data: `addItems`, `updateItems`, `removeItems`, `changeItems`;
  - commands: `applyCommand(command)`, undone with `command.inverse`;
  - focus and scroll: `focusItem`, `scrollLanes`, `revealLane`;
  - `exportSvg()`;
  - `update(config)` compares the option objects, `domain` and `selectedIds` by what they say: a host that hands its props again on every render neither restarts a drag nor moves the view back. A new fetch function for `items` is called from the next fetch on; `setItems` reloads.
  - The instance inherits from a frozen `Timeline` prototype, so a framework's reactive proxy does not wrap it.
- **Plugins are registered once for the page:** the registry lives on the global object under `Symbol.for("@temporeum/timeline/plugins")`, so two copies of the element (its ESM and CJS builds, or two bundles) share it. The core is a `^1.0.0` dependency.
- **Events:** every event the instance emits is listed once in `TIMELINE_EVENTS`; the element and the framework adapters forward these.
- **`<temporeum-timeline>`**: moved in the document (an `append` into another parent, `moveBefore`, a framework reordering a list), it keeps its instance — view, selection, edits and listeners; removed, it lets go after the task's microtasks. Properties set before the element is defined go through its setters on upgrade. `orientation`, `density`, `theme`, `height` and `editable` are properties as well as attributes; `config` replaces what the `config` before it said; the tag is in `HTMLElementTagNameMap` and its events are typed (`TimelineElementEventMap`); a Custom Elements Manifest ships as `dist/custom-elements.json`. `element.focus()` reaches the timeline (a delegating shadow root, on the server too), and `aria-labelledby` on the host names it by the text of the elements it points at. Attributes (the accessible name is `aria-label`), properties, a JSON child for configuration, kebab-case DOM events (the instance's `command` is `timeline-command`, clear of the platform's `command` event) and an open shadow root. `/define` registers it.
- **Server rendering:** `renderTimelineHtml` and `renderTimelineSvg`, with a declarative shadow root, taken over on the client without drawing again.
- **The base configuration:**
  - items and lanes, `theme`, `hooks`;
  - labels: `labelOverflow`, `maxLabels`, `formatTick`;
  - touch: `touchAction` (`"cooperative"` leaves the page's scroll to the page);
  - editing: move, resize, snap, `snapOrigin`, `minDurationMs`, `crossLane`, `canMove`.

- `axisContext` (on by default): the month, year or day the view is in, at the start of the axis.
- **Text spacing (WCAG 1.4.12):** labels are measured with the reader's letter and word spacing, read off a drawn label, and measured and laid out again when that spacing comes or goes after load, so a label keeps its whole text where its item has room.

### Plugins

A plain timeline downloads only what it uses. The rest is a plugin on an entry point of its own, registered once for the page with `registerPlugin(...plugins)` (`hasPlugin(name)` asks). A configuration, a live change or a command that needs a missing plugin throws a `TypeError` naming the import, before anything changes. The `<script>`-tag build (`timeline-element.umd.js`) carries every plugin and registers them on load.

- **`/gantt`** — `ganttPlugin`: the `gantt` option draws dependency arrows, progress, baselines and milestones, and `[` and `]` move the focus to a predecessor and a successor. `mountTaskGrid` is the table beside the chart: a `role="grid"` that keeps only the rows in view in the document.
- **`/resources`** — `resourcesPlugin`: the `resources` and `resourceOptions` options, with load lanes, overload bands and overbooked assignments. `mountBacklog` holds the unscheduled tasks, placed by a drag or with `Enter`.
- **`/export`** — `exportPlugin`: `exportPng`, `exportPdf` (the whole range, paginated) and `print`.
- **`/tools`** — `toolsPlugin`: `hiddenDates`, `timeBars`, `rolling`, `zoomPresets`, `minimap`, `rangeSelect`, `laneHeaders`, `tooltip`, and the `timeBarMoved` and `rangeSelected` events.
- **`/groups`** — `groupsPlugin`: nested groups as a `role="tree"` beside the drawing, collapsed and reordered by pointer and by key.
- **`/items`** — `itemsPlugin`: `box`, `point` and `background` items, `template` (sanitised HTML), and `editing.add`, `editing.remove` and `editing.drop`.
- **`/intl`** — `intlPlugin`: `strings` (every word the library says), `calendar` (the axis in a calendar `Intl` knows), and `direction: "rtl"` and `"auto"`.
- **`/calendar`** — `mountCalendarView`: a week or a day of events beside the timeline, with recurrence expanded for the period shown.

### Styling

- **`<temporeum-timeline>` styled from the page.** The tokens a page sets on the element reach the drawing (they are declared on `:host` in the shadow root), and every node of the drawing, the group tree and the time tools carries its classes as `part`s: `temporeum-timeline::part(item-selected)`, `::part(urgent)` for an item's `className`. A server-rendered element prints both; an export is drawn with the theme's own stylesheet.
- **`metrics`** (`SizeOverrides`, `MetricsSetting`): a row's height, the gaps, the type sizes, the corners and the font stack over the density's, as configuration — the layout packs and measures with them, and `density: "auto"` decides with them. An object, or a function of the level's own sizes. A size nothing can be drawn at, or a font stack that would end the stylesheet's rule, is a `RangeError` where it is configured. `timeline.metrics` says what the last frame was drawn with.
- **`slots`**: an empty box over each item (or those a function picks) for a framework to render into, with the `/items` plugin. `timeline.slots` and the `slotsChanged` event give each drawn item a host of its own — the same element while the item is drawn, through pans, zooms and live data — announced in the frame that drew it. `ItemSlot`, `SlotsChangedPayload`.

### Stories (`@temporeum/timeline-element/story`)

- `mountStory`: a panel that tells the items' slides one at a time beside the timeline — media, date, headline, text — with Previous and Next, ← → Home End, and each change said once. The panel and the timeline move together: a slide selects its item and brings it into view, a selection opens its slide. A title slide shows the whole story; `hash` names the slide in the address. Not a plugin: nothing to register.
- A provider's player loads when the reader asks for it (`media: "click"`, the default), by a button that names the host it loads from.
- `storyHtml`: TimelineJS's HTML kept as far as it is safe — text, emphasis, paragraphs, lists, quotes and links — rebuilt from an inert template, never assigned. `storyCss`, `STORY_STRINGS`.
- The `<script>`-tag build carries the story panel.

### Packaging

- ESM and CommonJS builds, the `/define` subpath, and a self-contained, minified UMD file for a `<script>` tag. MIT, published with npm provenance.
