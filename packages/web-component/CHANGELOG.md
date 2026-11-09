# Changelog

## 1.0.2 — 2026-11-09

On 1.0.2 of `@temporeum/timeline-core`.

### Fixed

- An era's name (`decorations`) is in the axis band, where the items cannot cover it — the core's fix.
- Down a vertical timeline, a point's label starts past its dot, not under it — the core's fix.

### Changed

- The element's size budget is 58.5 kB with the engine (was 53 kB), the UMD file's 116 kB (was 106 kB): room of at least 10% over the size, so a fix is not a hunt for bytes. The sizes are what they were.

## 1.0.1 — 2026-11-09

On 1.0.1 of `@temporeum/timeline-core`.

### Fixed

- The keyboard's focus ring on a point is a circle round its dot, on a Gantt milestone a diamond round its diamond, not a tall oval beside them.
- A vertical timeline's lane headers (`laneHeaders: true`) sit at the top of their column, a line of text as wide as the name, not over the column's first items.

## 1.0.0 — 2026-11-07

The first release, on 1.0.0 of `@temporeum/timeline-core`. From here on the package follows [semantic versioning](https://horakdani.github.io/Temporeum_timeline_SDK/stability.html): nothing public is removed before 2.0.

### The timeline

- **`createTimeline(container, config)`**: the live timeline. It measures, draws once per frame in the engine's scene space, and takes pointer, wheel and keyboard input. It also covers editing, async items and clusters, and an external store (`subscribe`, `getSnapshot`) that notifies at most once per frame, and at once when the selection or the focus changes: a `selectionChanged` listener, or a caller right after `focusItem`, reads the new state from `getSnapshot()` and the element's `selectedIds`.
- **The host:** a container that is not positioned is made `position: relative` while the timeline lives (and let go of at `destroy()`), so the tools and the group layer lie on the drawing and not on whatever ancestor is positioned. The default tooltip reads dates before year 1 with their era.
- **The instance:**
  - live data: `addItems`, `updateItems`, `removeItems`, `changeItems`;
  - commands: `applyCommand(command)`, undone with `command.inverse`;
  - focus and scroll: `focusItem`, `scrollLanes`, `revealLane`;
  - `exportSvg()`;
  - `update(config)` compares the option objects, `domain` and `selectedIds` by what they say: a host that hands its props again on every render neither restarts a drag nor moves the view back. A new fetch function for `items` is called from the next fetch on; `setItems` reloads.
  - The instance inherits from a frozen `Timeline` prototype, so a framework's reactive proxy does not wrap it.
- **Plugins are registered once for the page:** the registry lives on the global object under a registered symbol, so two copies of the element of one release (its ESM and CJS builds, or two bundles) share it. Each release has its own: a copy of another release — a CDN build beside a bundle — never draws with plugins whose internals it does not know, and says which import it lacks. The core is a `^1.0.0` dependency.
- **Types:** the data a host writes and the payloads it reads come from the element too — `Item`, `Lane`, `Command` and `ItemPatch` (an undo stack's), the payloads — so a host or an adapter that installs only the element types everything with what it installed. `TimelineInstance` is `Timeline` by the name the adapters give it, where `Timeline` is the component.
- **Events:** every event the instance emits is listed once in `TIMELINE_EVENTS`; the element and the framework adapters forward these. An item the timeline cannot read (no string id, a start or end that is not a time, a fractional `sublaneSpan`) is left out, a `locale` or `timeZone` the platform does not know falls back to the default, and so does a `theme` with a token that is not a colour; a decoration, a time bar or a hidden stretch of no known kind or with a time that is not one is left out of its list — on the client and the server alike — and `inputSkipped` (`input-skipped`) says which, so one bad item does not take the whole frame.
- **`<temporeum-timeline>`**: moved in the document (an `append` into another parent, `moveBefore`, a framework reordering a list), it keeps its instance — view, selection, edits and listeners; removed, it lets go after the task's microtasks, and put back later it draws the items and the selection it was let go with. `items`, like `domain` and `selectedIds`, reads what is drawn, a drag or `updateItems` included. The getters and `config` read the JSON child too, under the attributes and the properties; a property or an attribute handed back falls back to it. Properties set before the element is defined go through its setters on upgrade. Every attribute has a property as its pair (`start` and `end` are `domain`), which wins over it until it is set to `undefined`; `editable`, `multiSelect` and `snapMs` are each one field of `editing`, so one set as a property leaves the others' attributes in force. `config` replaces what the `config` before it said; the tag is in `HTMLElementTagNameMap` and its events are typed (`TimelineElementEventMap`); a Custom Elements Manifest ships as `dist/custom-elements.json`, with each attribute's property, the theme's `--tl-*` tokens and the drawing's parts. `element.focus()` reaches the timeline (a delegating shadow root, on the server too), and `aria-labelledby` on the host names it by the text of the elements it points at — live, as the platform's is: a change to that text, or a label put in later, names it anew. Attributes (the accessible name is `aria-label`), properties, a JSON child for configuration (every date in it may be text: the items', the domain's, the decorations', the time bars', the hidden stretches', the limits'), kebab-case DOM events (the instance's `command` is `timeline-command`, clear of the platform's `command` event) and an open shadow root. `/define` registers it.
- The options of the calendar view, the task grid, the backlog and the server renderers take an explicit `undefined` in every optional field, as the configuration does (`exactOptionalPropertyTypes`).
- `createTimeline`'s third argument turns the page-font measuring off with `measureLabels: false` (the configuration's `measureText` is the measuring function). `groups` given again with the same content keep the order the reader dragged them into. `OBSERVED_ATTRIBUTES` and `STORY_STRINGS` are frozen.
- **Server rendering:** `renderTimelineHtml` and `renderTimelineSvg`, with a declarative shadow root, taken over on the client without drawing again. `tagName` must be a custom element name and `attributes` attribute names, never an `on…` handler; values are escaped.
- **Content Security Policy and Trusted Types:** the timeline runs under `style-src 'self'` and `require-trusted-types-for 'script'`. Every stylesheet — the drawing's, the element's, the group tree's, the time tools', the story's, the backlog's, the task grid's, the calendar view's, the print view's — is a constructed sheet in `adoptedStyleSheets`, and every inline style goes through the CSSOM. `nonce` (the element's `nonce` attribute) is for the `<style>`s of the server's markup and of a browser without constructable sheets; `renderTimelineHtml` puts it on the element, not in the JSON, and the companions take it from `timeline.nonce`. The story's inert parse of TimelineJS's HTML goes through a `temporeum-timeline` Trusted Types policy (`TRUSTED_TYPES_POLICY`) kept inside the library, or the host's (`trustedTypesPolicy`). See the guide on Content Security Policy.
- **The base configuration:**
  - items and lanes, `theme`, `hooks`;
  - labels: `labelOverflow`, `maxLabels`, `formatTick`;
  - touch: `touchAction` (`"cooperative"` leaves the page's scroll to the page);
  - editing: move, resize, snap, `snapOrigin`, `minDurationMs`, `crossLane`, `canMove`. A grid of whole days snaps to the timeline zone's midnights all year, and an item known to the day is resized by the edge it is drawn with.

- `axisContext` (on by default): the month, year or day the view is in, at the start of the axis.
- **Text spacing (WCAG 1.4.12):** labels are measured with the reader's letter and word spacing, read off a drawn label, and measured and laid out again when that spacing comes or goes after load, so a label keeps its whole text where its item has room.

### Plugins

A plain timeline downloads only what it uses. The rest is a plugin on an entry point of its own, registered once for the page with `registerPlugin(...plugins)` (`hasPlugin(name)` asks). A configuration, a live change or a command that needs a missing plugin throws a `TypeError` naming the import, before anything changes. The `<script>`-tag build (`timeline-element.umd.js`) carries every plugin and registers them on load.

- **`/gantt`** — `ganttPlugin`: the `gantt` option draws dependency arrows, progress, baselines and milestones, and `[` and `]` move the focus to a predecessor and a successor. `mountTaskGrid` is the table beside the chart: a `role="grid"` that keeps only the rows in view in the document.
- **`/resources`** — `resourcesPlugin`: the `resources` and `resourceOptions` options, with load lanes, overload bands and overbooked assignments. `mountBacklog` holds the unscheduled tasks, placed by a drag or with `Enter`.
- **`/export`** — `exportPlugin`: `exportPng`, `exportPdf` (the whole range, paginated) and `print`. Without the plugin their promises reject, naming the import; before the first frame every export, `exportSvg` included, says "Nothing drawn yet".
- **`/tools`** — `toolsPlugin`: `hiddenDates`, `timeBars`, `rolling`, `zoomPresets`, `minimap`, `rangeSelect`, `laneHeaders`, `tooltip`, and the `timeBarMoved` and `rangeSelected` events.
- **`/groups`** — `groupsPlugin`: nested groups as a `role="tree"` beside the drawing, collapsed and reordered by pointer and by key.
- **`/items`** — `itemsPlugin`: `box`, `point` and `background` items, `template` (sanitised HTML), and `editing.add`, `editing.remove` and `editing.drop`.
- **`/intl`** — `intlPlugin`: `strings` (every word the library says), `calendar` (the axis in a calendar `Intl` knows), and `direction: "rtl"` and `"auto"`.
- **`/calendar`** — not a plugin, nothing to register: `mountCalendarView` mounts a week or a day of events beside the timeline, with recurrence expanded for the period shown.

### Styling

- **`<temporeum-timeline>` styled from the page.** The tokens a page sets on the element reach the drawing (they are declared on `:host` in the shadow root), and every node of the drawing, the group tree and the time tools carries its classes as `part`s: `temporeum-timeline::part(item-selected)`, `::part(urgent)` for an item's `className`. A server-rendered element prints both; an export is drawn with the theme's own stylesheet.
- **`metrics`** (`SizeOverrides`, `MetricsSetting`): a row's height, the gaps, the type sizes, the corners and the font stack over the density's, as configuration — the layout packs and measures with them, and `density: "auto"` decides with them. An object, or a function of the level's own sizes. A size nothing can be drawn at, or a font stack that would end the stylesheet's rule, is a `RangeError` where it is configured. `timeline.metrics` says what the last frame was drawn with.
- **`slots`**: an empty box over each item (or those a function picks) for a framework to render into, with the `/items` plugin. `timeline.slots` and the `slotsChanged` event give each drawn item a host of its own — the same element while the item is drawn, through pans, zooms and live data — announced in the frame that drew it. `ItemSlot`, `SlotsChangedPayload`.

### Stories (`@temporeum/timeline-element/story`)

- `mountStory`: a panel that tells the items' slides one at a time beside the timeline — media, date, headline, text — with Previous and Next, ← → Home End, and each change said once. The panel and the timeline move together: a slide selects its item and brings it into view, a selection opens its slide. A title slide shows the whole story; `hash` names the slide in the address. Not a plugin: nothing to register.
- Every mounted handle has the same verbs: `update(options)` changes the options given and keeps the rest (a companion — the calendar view, the task grid, the backlog, the story — draws again without options; the backlog's tasks are `update({ tasks })`); `next()` and `previous()` say whether there was one; events come through `on(event, handler)`: the calendar view's `itemSelect` and `rangeChanged`, the story's `slideChanged`, the opening slide included. The story's `update` takes its words, theme, title slide, `slide` and `hash`, and stays on the slide shown.
- A provider's player loads when the reader asks for it (`media: "click"`, the default), by a button that names the host it loads from, in a sandboxed frame that cannot navigate the page.
- `storyHtml`: TimelineJS's HTML kept as far as it is safe — text, emphasis, paragraphs, lists, quotes and links — rebuilt from an inert template, never assigned. `storyCss`, `STORY_STRINGS`.
- The `<script>`-tag build carries the story panel.

### Packaging

- ESM and CommonJS builds, the `/define` subpath, and a self-contained, minified UMD file for a `<script>` tag. MIT. Published with npm provenance, unless 1.0.0 has to be created by hand first ([stability](https://horakdani.github.io/Temporeum_timeline_SDK/stability.html)).
